import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
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
      await runStep("INSPECT_CHANGE_LIMIT_FORM", () => this.inspectChangeLimitForm(page, vehiclePlate));
      await runStep("INSPECT_EVA_FLOW", () => this.inspectEvaFlow(page, vehiclePlate));

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

    await saveStorageState(page.context());
    await page.goto(vehicleListUrl);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);

    const loginReturned = await isVisible(page.getByLabel(/usu.rio|e-mail|email|login/i));
    const vehiclePageVisible = await isVisible(page.getByText(/ve.culos|placa/i));
    if (loginReturned || !vehiclePageVisible) {
      throw new ManualInterventionError("MANUAL_LOGIN_NOT_CONFIRMED");
    }

    await saveStorageState(page.context());
    return "Login manual concluido, sessao salva e pagina de veiculos acessivel";
  }

  private async openVehicleList(page: Page): Promise<string> {
    const vehicleListUrl = process.env.TICKETLOG_VEHICLE_LIST_URL;
    if (!vehicleListUrl) throw new Error("TICKETLOG_VEHICLE_LIST_URL is required");

    await page.goto(vehicleListUrl);
    await expect(page.getByText(/ve.culos|placa/i).first()).toBeVisible();
    await this.stopOnHumanChallenge(page);
    return "Pagina de veiculos carregada";
  }

  private async searchPlate(page: Page, plate: string): Promise<string> {
    await page.getByLabel(/placa/i).fill(plate);
    await page.getByRole("button", { name: /pesquisar|buscar|filtrar/i }).click();
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);

    const rows = page.getByRole("row").filter({ hasText: plate });
    const count = await rows.count();
    if (count === 0) throw new ManualInterventionError("PLATE_NOT_FOUND");
    if (count > 1) throw new ManualInterventionError("MULTIPLE_PLATE_RESULTS");

    return "Um resultado encontrado para a placa";
  }

  private async openPlate(page: Page, plate: string): Promise<string> {
    await page.getByRole("link", { name: new RegExp(plate, "i") }).click();
    await expect(page.getByText(plate).first()).toBeVisible();
    return "Detalhe do veiculo aberto";
  }

  private async readStatus(page: Page): Promise<string> {
    if (await isVisible(page.getByText(/bloquead[oa]/i))) {
      return "Veiculo aparece como bloqueado; validacao nao clica em Desbloquear";
    }

    if (await isVisible(page.getByText(/ativo|liberad[oa]|desbloquead[oa]/i))) {
      return "Status visivel indica veiculo ativo/liberado";
    }

    return "Status nao identificado com seguranca; revisar seletor na homologacao";
  }

  private async readCurrentLimit(page: Page): Promise<string> {
    const label = page.getByText(/limite atual/i).first();
    if (!(await isVisible(label))) {
      return "Campo limite atual nao encontrado; pode depender do layout ou permissao";
    }

    const text = await label.locator("..").innerText();
    const sanitized = text.replace(/\d(?=\d{2})/g, "*").slice(0, 160);
    return `Area de limite atual encontrada: ${sanitized}`;
  }

  private async inspectChangeLimitForm(page: Page, plate: string): Promise<string> {
    await page.getByRole("button", { name: /alterar limite/i }).click();

    await expect(page.getByLabel(/adicionar.*limite atual/i)).toBeVisible();
    await expect(page.getByLabel(/valor/i)).toBeVisible();
    await expect(page.getByLabel(/somente para o per.odo/i)).toBeVisible();
    await expect(page.getByLabel(/motivo/i)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: new RegExp(plate, "i") })).toBeVisible();
    await expect(page.getByRole("button", { name: /^alterar$/i })).toBeVisible();

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

    await page.getByText(/transa..es/i).click();
    await page.getByText(/liberar abastecimento.*restri..o/i).click();

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
