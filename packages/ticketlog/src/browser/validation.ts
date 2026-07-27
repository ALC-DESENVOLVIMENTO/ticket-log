import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium, expect, type Browser, type BrowserContext, type Frame, type Locator, type Page } from "@playwright/test";
import { ManualInterventionError, normalizePlate } from "@ticketlog/domain";

type StepStatus = "PASSED" | "FAILED" | "SKIPPED";

export interface TicketLogValidationStep {
  key: string;
  status: StepStatus;
  detail?: string;
  startedAt: string;
  finishedAt: string;
}

export interface TicketLogValidationReport {
  mode: "read_only";
  safeGuards: string[];
  vehiclePlate: string;
  startedAt: string;
  finishedAt: string;
  steps: TicketLogValidationStep[];
  result: "PASSED" | "FAILED";
}

interface ValidationOptions {
  vehiclePlate: string;
  outputPath?: string;
}

interface BrowserSession {
  context: BrowserContext;
  close(): Promise<void>;
}

const safeGuards = [
  "Nao clica no botao final Alterar",
  "Nao confirma desbloqueio de veiculo",
  "Nao envia solicitacao para a EVA",
  "Interrompe quando encontra CAPTCHA, MFA ou confirmacao inesperada fora do modo manual",
];

export class BrowserTicketLogValidator {
  async validateReadOnly(options: ValidationOptions): Promise<TicketLogValidationReport> {
    const startedAt = new Date().toISOString();
    const steps: TicketLogValidationStep[] = [];
    const session = await this.createBrowserSession();
    const context = session.context;
    const page = await context.newPage();
    const vehiclePlate = normalizePlate(options.vehiclePlate);

    const runStep = async (key: string, action: () => Promise<string | void>): Promise<boolean> => {
      const stepStartedAt = new Date().toISOString();
      try {
        const detail = await action();
        steps.push({
          key,
          status: "PASSED",
          detail: detail ?? undefined,
          startedAt: stepStartedAt,
          finishedAt: new Date().toISOString(),
        });
        return true;
      } catch (error) {
        steps.push({
          key,
          status: "FAILED",
          detail: error instanceof Error ? error.message : "UNKNOWN_ERROR",
          startedAt: stepStartedAt,
          finishedAt: new Date().toISOString(),
        });
        return false;
      }
    };

    const skipStep = (key: string, detail: string): void => {
      const now = new Date().toISOString();
      steps.push({
        key,
        status: "SKIPPED",
        detail,
        startedAt: now,
        finishedAt: now,
      });
    };

    try {
      if (!(await runStep("AUTHENTICATE", () => this.ensureAuthenticated(page)))) {
        return this.finishReport({ startedAt, steps, vehiclePlate, outputPath: options.outputPath });
      }

      if (!(await runStep("OPEN_VEHICLE_LIST", () => this.openVehicleList(page)))) {
        return this.finishReport({ startedAt, steps, vehiclePlate, outputPath: options.outputPath });
      }

      if (!(await runStep("SEARCH_PLATE", () => this.searchPlate(page, vehiclePlate)))) {
        return this.finishReport({ startedAt, steps, vehiclePlate, outputPath: options.outputPath });
      }

      if (!(await runStep("OPEN_PLATE", () => this.openPlate(page, vehiclePlate)))) {
        return this.finishReport({ startedAt, steps, vehiclePlate, outputPath: options.outputPath });
      }

      await runStep("READ_STATUS", () => this.readStatus(page));
      await runStep("READ_CURRENT_LIMIT", () => this.readCurrentLimit(page));
      const changeLimitFormOk = await runStep("INSPECT_CHANGE_LIMIT_FORM", () =>
        this.inspectChangeLimitForm(page, vehiclePlate),
      );
      if (!changeLimitFormOk) {
        skipStep("INSPECT_EVA_FLOW", "EVA nao validada porque a etapa de limite nao foi validada");
        return this.finishReport({ startedAt, steps, vehiclePlate, outputPath: options.outputPath });
      }

      if (process.env.TICKETLOG_VALIDATE_EVA_FLOW === "true") {
        await runStep("INSPECT_EVA_FLOW", () => this.inspectEvaFlow(page, vehiclePlate));
      } else {
        skipStep("INSPECT_EVA_FLOW", "EVA ignorada no validate:browser padrao; habilite TICKETLOG_VALIDATE_EVA_FLOW=true para validar separadamente");
      }

      await saveStorageState(context);

      return this.finishReport({ startedAt, steps, vehiclePlate, outputPath: options.outputPath });
    } finally {
      if (process.env.TICKETLOG_KEEP_BROWSER_OPEN === "true") {
        await waitBeforeClosingBrowser();
      }
      await session.close();
    }
  }

  private async createBrowserSession(): Promise<BrowserSession> {
    const headless = process.env.TICKETLOG_HEADLESS !== "false";
    const userDataDir = process.env.TICKETLOG_USER_DATA_DIR;

    if (userDataDir) {
      await mkdir(userDataDir, { recursive: true });
      const context = await chromium.launchPersistentContext(userDataDir, { headless });
      return {
        context,
        close: () => context.close(),
      };
    }

    const browser = await chromium.launch({ headless });
    const context = await this.createContext(browser);
    return {
      context,
      close: () => browser.close(),
    };
  }

  private async createContext(browser: Browser): Promise<BrowserContext> {
    const storageState = process.env.TICKETLOG_SESSION_STORAGE_PATH;
    if (!storageState) return browser.newContext();

    try {
      await access(storageState);
      return browser.newContext({ storageState });
    } catch {
      return browser.newContext();
    }
  }

  private async ensureAuthenticated(page: Page): Promise<string> {
    const loginUrl = process.env.TICKETLOG_LOGIN_URL;
    const allowManualLogin = process.env.TICKETLOG_ALLOW_MANUAL_LOGIN === "true";
    if (loginUrl) {
      await page.goto(loginUrl);
      if (allowManualLogin) {
        return this.waitForManualLogin(page);
      }
      await this.stopOnHumanChallenge(page);
    }

    const username = process.env.TICKETLOG_USERNAME;
    const password = process.env.TICKETLOG_PASSWORD;
    const userField = page.getByLabel(/usu.rio|e-mail|email|login/i);

    if (await isVisible(userField)) {
      if (!username || !password) {
        if (allowManualLogin) {
          return this.waitForManualLogin(page);
        }
        throw new ManualInterventionError("TICKETLOG_CREDENTIALS_REQUIRED_FOR_LOGIN");
      }

      await userField.fill(username);
      await page.getByLabel(/senha/i).fill(password);
      await page.getByRole("button", { name: /entrar|acessar|login/i }).click();
      await page.waitForLoadState("domcontentloaded");
      await this.stopOnHumanChallenge(page);
    }

    return "Sessao autenticada ou login basico concluido";
  }

  private async waitForManualLogin(page: Page): Promise<string> {
    const vehicleListUrl = process.env.TICKETLOG_VEHICLE_LIST_URL;
    if (!vehicleListUrl) throw new Error("TICKETLOG_VEHICLE_LIST_URL is required");

    console.error(
      "TICKETLOG_ALLOW_MANUAL_LOGIN=true: faca login, SMS/MFA/reCAPTCHA se aparecer, e pressione Enter no terminal quando estiver dentro da Ticket Log.",
    );

    if (process.env.TICKETLOG_MANUAL_LOGIN_CONTINUE !== "auto" && process.stdin.isTTY) {
      await waitForEnter("Pressione Enter apos concluir login/codigo no navegador...");
    } else {
      const timeoutMs = Number(process.env.TICKETLOG_MANUAL_LOGIN_TIMEOUT_MS ?? 10 * 60_000);
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (page.isClosed()) throw new ManualInterventionError("BROWSER_CLOSED_DURING_MANUAL_LOGIN");
        const loginFieldStillVisible = await isVisible(page.getByLabel(/usu.rio|e-mail|email|login/i));
        const passwordFieldStillVisible = await isVisible(page.getByLabel(/senha/i));
        if (!loginFieldStillVisible && !passwordFieldStillVisible) break;
        await page.waitForTimeout(1500);
      }
    }

    if (page.isClosed()) {
      throw new ManualInterventionError("BROWSER_CLOSED_DURING_MANUAL_LOGIN");
    }

    const loginReturned = await isVisible(page.getByLabel(/usu.rio|e-mail|email|login/i));
    const platformShellVisible = await isVisible(page.getByText(/in.cio|acesso r.pido|sou log|ticket log|ve.culos|placa/i));
    if (loginReturned || !platformShellVisible) {
      throw new ManualInterventionError("MANUAL_LOGIN_NOT_CONFIRMED");
    }

    await saveStorageState(page.context());
    await page.goto(vehicleListUrl);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    return "Login manual concluido e sessao salva";
  }

  private async openVehicleList(page: Page): Promise<string> {
    const vehicleListUrl = process.env.TICKETLOG_VEHICLE_LIST_URL;
    if (!vehicleListUrl) throw new Error("TICKETLOG_VEHICLE_LIST_URL is required");

    await page.goto(vehicleListUrl);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    if (!(await waitForVehicleListReady(page, 5_000))) {
      await clickVehicleListEntrypoint(page);
    }

    if (!(await waitForVehicleListReady(page))) {
      throw new ManualInterventionError("VEHICLE_LIST_NOT_LOADED");
    }

    await this.stopOnHumanChallenge(page);
    return "Pagina de veiculos carregada";
  }

  private async searchPlate(page: Page, plate: string): Promise<string> {
    const plateSearch = await firstVisible([
      page.getByLabel(/placa|identificador/i),
      page.getByPlaceholder(/placa|identificador|pesquise|busque|buscar na tabela/i),
      page.locator("input:visible").first(),
      page.getByRole("textbox").first(),
    ]);

    await plateSearch.fill(plate);
    const searchButton = page.getByRole("button", { name: /pesquisar|buscar|filtrar/i }).first();
    if (await isVisible(searchButton)) {
      await searchButton.click();
    } else {
      await plateSearch.press("Enter");
    }
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await waitForPlateSearchResult(page, plate);

    const rows = page.getByRole("row").filter({ hasText: plate });
    const count = await rows.count();
    if (count === 0) throw new ManualInterventionError("PLATE_NOT_FOUND");
    if (count > 1) throw new ManualInterventionError("MULTIPLE_PLATE_RESULTS");

    return "Um resultado encontrado para a placa";
  }

  private async openPlate(page: Page, plate: string): Promise<string> {
    const plateLink = await firstVisible([
      page.getByRole("link", { name: new RegExp(plate, "i") }),
      page.getByText(plate, { exact: false }).first(),
    ]);
    await plateLink.click();
    await expect(page.getByText(plate).first()).toBeVisible();
    await expect(page.getByText(/detalhes do ve.culo/i).first()).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
    return "Detalhe do veiculo aberto";
  }

  private async readStatus(page: Page): Promise<string> {
    const activeBadge = page.getByText(/^ativo$/i).first();
    if (await isVisible(activeBadge)) {
      return "Status visivel indica veiculo ativo/liberado";
    }

    const blockedBadge = page.getByText(/^bloquead[oa](?:\s|$)/i).first();
    if (await isVisible(blockedBadge)) {
      return "Veiculo aparece como bloqueado; validacao nao clica em Desbloquear";
    }

    if (await isVisible(page.getByText(/liberad[oa]|desbloquead[oa]/i).first())) {
      return "Status visivel indica veiculo ativo/liberado";
    }

    return "Status nao identificado com seguranca; revisar seletor na homologacao";
  }

  private async readCurrentLimit(page: Page): Promise<string> {
    const label = page.getByText(/limite atual|limite total/i).first();
    if (!(await isVisible(label))) {
      return "Campo limite atual nao encontrado; pode depender do layout ou permissao";
    }

    const text = await label.locator("..").innerText();
    const sanitized = text.replace(/\d(?=\d{2})/g, "*").slice(0, 160);
    return `Area de limite atual encontrada: ${sanitized}`;
  }

  private async inspectChangeLimitForm(page: Page, plate: string): Promise<string> {
    const formAlreadyOpen = await waitForChangeLimitForm(page, 1_000);
    if (!formAlreadyOpen) {
      await expect(page.getByText(/detalhes do ve.culo/i).first()).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
      await clickChangeLimitEntrypoint(page);
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    }

    const formFrame = await waitForChangeLimitFrame(page);
    if (!formFrame) {
      throw new ManualInterventionError("CHANGE_LIMIT_FORM_NOT_LOADED");
    }

    const bodyText = await formFrame.locator("body").innerText({ timeout: 10_000 });
    if (!/adicionar\s+o\s+valor\s+ao\s+limite\s+atual/i.test(bodyText)) {
      throw new ManualInterventionError("ADD_TO_CURRENT_LIMIT_OPTION_NOT_FOUND");
    }
    if (!/somente\s+para\s+o\s+per.odo/i.test(bodyText)) {
      throw new ManualInterventionError("CURRENT_PERIOD_OPTION_NOT_FOUND");
    }
    if (!/motivo/i.test(bodyText)) {
      throw new ManualInterventionError("LIMIT_REASON_FIELD_NOT_FOUND");
    }

    await expect(formFrame.locator("input#valor, input[name='valor']").first()).toBeVisible();
    await expect(formFrame.locator("input[type='radio'][name='tipo'][value='AR']").first()).toBeVisible();
    await expect(formFrame.locator("input[type='radio'][name='fl_tipo_operacao'][value='SP']").first()).toBeVisible();
    await expect(formFrame.locator("input#ds_justifica, input[name='ds_justifica']").first()).toBeVisible();

    const row = formFrame.locator("tr").filter({ hasText: plate });
    if ((await row.count()) !== 1) {
      throw new ManualInterventionError("PLATE_ROW_NOT_FOUND_ON_LIMIT_FORM");
    }
    await expect(row.first().locator("input[type='checkbox'][name='chklimite']").first()).toBeVisible();
    await expect(formFrame.locator("input#btnAlterar, input[type='button'][value='Alterar']").first()).toBeVisible();

    await this.closeDialogIfPossible(page);
    return "Formulario de alterar limite encontrado; botao final nao foi acionado";
  }

  private async inspectEvaFlow(page: Page, plate: string): Promise<string> {
    const evaButton = page.getByRole("button", { name: /eva|assistente virtual/i });
    if (!(await isVisible(evaButton))) {
      return "Icone/botao EVA nao encontrado nesta tela";
    }

    await evaButton.click();
    await expect(page.getByText(/eva|assistente/i).first()).toBeVisible();

    const panel = await getEvaPanel(page);
    await firstVisible([
      panel.getByRole("button", { name: /^transa..es$/i }),
      panel.getByText(/^\s*transa..es\s*$/i),
    ]).then((locator) => locator.click());

    const updatedPanel = await getEvaPanel(page);
    await firstVisible([
      updatedPanel.getByRole("button", { name: /liberar abastecimento.*restri..o/i }),
      updatedPanel.getByText(/^\s*liberar abastecimento.*restri..o\s*$/i),
    ]).then((locator) => locator.click());

    const textboxes = page.getByRole("textbox");
    if ((await textboxes.count()) === 0) {
      throw new ManualInterventionError("EVA_PLATE_TEXTBOX_NOT_FOUND");
    }

    await textboxes.last().fill(plate);
    await expect(page.getByRole("button", { name: /enviar|confirmar/i })).toBeVisible();
    await this.closeDialogIfPossible(page);
    return "Fluxo EVA localizado e placa preenchida; envio nao foi acionado";
  }

  private async closeDialogIfPossible(page: Page): Promise<void> {
    const cancel = page.getByRole("button", { name: /cancelar|fechar|voltar/i }).first();
    if (await isVisible(cancel)) {
      await cancel.click();
      return;
    }

    await page.keyboard.press("Escape").catch(() => undefined);
  }

  private async stopOnHumanChallenge(page: Page): Promise<void> {
    if (await isVisible(page.getByText(/captcha|mfa|autenticador|token|c.digo/i))) {
      throw new ManualInterventionError("UNEXPECTED_CAPTCHA_OR_MFA");
    }
  }

  private async finishReport(input: {
    startedAt: string;
    steps: TicketLogValidationStep[];
    vehiclePlate: string;
    outputPath?: string;
  }): Promise<TicketLogValidationReport> {
    const report: TicketLogValidationReport = {
      mode: "read_only",
      safeGuards,
      vehiclePlate: maskPlate(input.vehiclePlate),
      startedAt: input.startedAt,
      finishedAt: new Date().toISOString(),
      steps: input.steps,
      result: input.steps.every((step) => step.status !== "FAILED") ? "PASSED" : "FAILED",
    };

    if (input.outputPath) {
      await mkdir(dirname(input.outputPath), { recursive: true });
      await writeFile(input.outputPath, JSON.stringify(report, null, 2));
    }

    return report;
  }
}

export function defaultValidationOutputPath(): string {
  return join(process.cwd(), "artifacts", "ticketlog-validation", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

function maskPlate(plate: string): string {
  const normalized = normalizePlate(plate);
  if (normalized.length <= 3) return "***";
  return `${normalized.slice(0, 3)}***${normalized.slice(-1)}`;
}

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.first().isVisible().catch(() => false);
}

async function firstVisible(candidates: Locator[]): Promise<Locator> {
  for (const candidate of candidates) {
    const locator = candidate.first();
    if (await isVisible(locator)) return locator;
  }

  throw new Error("VISIBLE_LOCATOR_NOT_FOUND");
}

async function waitForPlateSearchResult(page: Page, plate: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const rows = page.getByRole("row").filter({ hasText: plate });
    if ((await rows.count()) > 0) return;

    const emptyState = page.getByText(/nenhum registro|nenhum resultado|n.o encontrado|sem resultado/i).first();
    if (await isVisible(emptyState)) return;

    await page.waitForTimeout(500);
  }
}

async function waitForVehicleListReady(page: Page, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const signals = [
      page.getByPlaceholder(/buscar na tabela/i).first(),
      page.getByText(/meus ve.culos\s*\/\s*equipamentos/i).first(),
      page.getByText(/placa\s*\/\s*identificador/i).first(),
    ];

    for (const signal of signals) {
      if (await isVisible(signal)) return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

async function clickVehicleListEntrypoint(page: Page): Promise<void> {
  const entrypoint = await firstVisible([
    page.getByText(/^\s*ve.culo\s*$/i).first(),
    page.getByText(/^\s*equipamento\s*$/i).first(),
    page.getByRole("link", { name: /ve.culo|equipamento/i }).first(),
  ]);

  await entrypoint.scrollIntoViewIfNeeded().catch(() => undefined);
  await entrypoint.click().catch(async () => {
    const box = await entrypoint.boundingBox();
    if (!box) throw new ManualInterventionError("VEHICLE_LIST_ENTRYPOINT_NOT_CLICKABLE");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  });
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

async function clickChangeLimitEntrypoint(page: Page): Promise<void> {
  const attempts: string[] = [];
  const direct = await firstVisible([
    page.getByRole("button", { name: /altera..o de limite|alterar limite/i }),
    page.getByRole("link", { name: /altera..o de limite|alterar limite/i }),
  ]).catch(() => null);

  if (direct) {
    attempts.push("direct-role");
    if (await clickAndConfirmChangeLimit(page, direct)) return;
  }

  const text = page.getByText(/^\s*alterar\s+limite\s*$/i).first();
  if (!(await isVisible(text))) {
    throw new ManualInterventionError("CHANGE_LIMIT_ENTRYPOINT_NOT_FOUND");
  }

  await text.scrollIntoViewIfNeeded();
  const clickableCard = text.locator(
    "xpath=ancestor::*[self::button or self::a or @role='button' or contains(@class,'card') or contains(@class,'Card')][1]",
  );

  attempts.push("ancestor-card");
  if (await clickAndConfirmChangeLimit(page, clickableCard)) return;
  attempts.push("text");
  if (await clickAndConfirmChangeLimit(page, text)) return;
  attempts.push("visual-centers");
  const visualResult = await clickVisualCardCenter(page, text);
  attempts.push(`url:${page.url()}`);
  if (visualResult) return;

  throw new ManualInterventionError(`CHANGE_LIMIT_CLICK_DID_NOT_OPEN_FORM:${attempts.join("|")}`);
}

async function getEvaPanel(page: Page): Promise<Locator> {
  const textbox = page.getByRole("textbox").last();
  await expect(textbox).toBeVisible({ timeout: 15_000 });
  const panel = textbox.locator("xpath=ancestor::*[contains(., 'EVA')][1]");
  if (await isVisible(panel)) return panel;
  throw new ManualInterventionError("EVA_PANEL_NOT_FOUND");
}

async function clickAndConfirmChangeLimit(page: Page, locator: Locator): Promise<boolean> {
  if (!(await isVisible(locator))) return false;

  await locator.click().catch(() => undefined);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  return waitForChangeLimitForm(page);
}

async function clickVisualCardCenter(page: Page, text: Locator): Promise<boolean> {
  const centers = await text.evaluate((element) => {
    const candidates: Array<{ x: number; y: number }> = [];
    const textRect = element.getBoundingClientRect();
    candidates.push({
      x: textRect.left + textRect.width / 2,
      y: textRect.top + textRect.height / 2,
    });
    candidates.push({
      x: textRect.left + textRect.width / 2,
      y: textRect.top - 70,
    });
    let current: HTMLElement | null = element instanceof HTMLElement ? element : element.parentElement;

    for (let index = 0; current && index < 8; index += 1) {
      const rect = current.getBoundingClientRect();
      if (rect.width >= 80 && rect.height >= 60) {
        candidates.push({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      }
      current = current.parentElement;
    }

    return candidates;
  });

  for (const center of centers) {
    await page.mouse.click(center.x, center.y);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    if (await waitForChangeLimitForm(page)) return true;
  }

  return false;
}

async function waitForChangeLimitForm(page: Page, timeoutMs = 45_000): Promise<boolean> {
  return (await waitForChangeLimitFrame(page, timeoutMs)) !== null;
}

async function waitForChangeLimitFrame(page: Page, timeoutMs = 45_000): Promise<Page | Frame | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);

    for (const scope of [page, ...page.frames()]) {
      const bodyText = await scope.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
      if (
        /valor\s+para\s+altera/i.test(bodyText) &&
        /adicionar\s+o\s+valor\s+ao\s+limite\s+atual/i.test(bodyText)
      ) {
        return scope;
      }
    }

    await page.waitForTimeout(500);
  }

  return null;
}

async function waitBeforeClosingBrowser(): Promise<void> {
  const timeoutMs = Number(process.env.TICKETLOG_KEEP_BROWSER_OPEN_MS ?? 0);

  if (timeoutMs > 0) {
    console.error(`TICKETLOG_KEEP_BROWSER_OPEN=true: mantendo navegador aberto por ${timeoutMs}ms.`);
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    return;
  }

  if (!process.stdin.isTTY) {
    console.error("TICKETLOG_KEEP_BROWSER_OPEN=true: stdin nao interativo; navegador permanecera aberto por 5 minutos.");
    await new Promise((resolve) => setTimeout(resolve, 5 * 60_000));
    return;
  }

  console.error("TICKETLOG_KEEP_BROWSER_OPEN=true: pressione Enter no terminal para fechar o navegador.");
  process.stdin.resume();
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

async function waitForEnter(message: string): Promise<void> {
  console.error(message);
  process.stdin.resume();
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

async function saveStorageState(context: BrowserContext): Promise<void> {
  const storageState = process.env.TICKETLOG_SESSION_STORAGE_PATH;
  if (!storageState) return;

  await mkdir(dirname(storageState), { recursive: true });
  await context.storageState({ path: storageState });
}
