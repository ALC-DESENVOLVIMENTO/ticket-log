import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { IndeterminateResultError, normalizePlate, ManualInterventionError } from "@ticketlog/domain";
import type {
  TicketLogLimitInput,
  TicketLogLimitResult,
  TicketLogProvider,
  TicketLogProviderHooks,
  TicketLogOperationalEvent,
} from "../provider.js";
import { EvaPage } from "./pages/EvaPage.js";
import { FleetVehiclePage } from "./pages/FleetVehiclePage.js";
import { hasStorageStateFile, hasUserDataDirState, resolveStorageStatePath, resolveUserDataDir } from "./sessionConfig.js";

interface BrowserSession {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

let sharedContextPromise: Promise<BrowserContext> | undefined;
let sharedOperationalPage: Page | undefined;

function browserLaunchArgs(headless: boolean): string[] | undefined {
  const args = [
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--disable-features=CrashRestoreBubble,InfiniteSessionRestore",
  ];
  if (!headless) {
    args.push("--start-maximized");
  }
  return args;
}

async function launchSharedPersistentContext(): Promise<BrowserContext> {
  const userDataDir = resolveUserDataDir();
  if (!userDataDir) {
    throw new ManualInterventionError("TICKETLOG_USER_DATA_DIR_REQUIRED_FOR_STATION");
  }
  await mkdir(userDataDir, { recursive: true });
  return chromium.launchPersistentContext(userDataDir, {
    headless: process.env.TICKETLOG_HEADLESS !== "false",
    viewport: process.env.TICKETLOG_HEADLESS === "false" ? null : undefined,
    args: browserLaunchArgs(process.env.TICKETLOG_HEADLESS !== "false"),
  });
}

async function getSharedOperationalPage(context: BrowserContext): Promise<Page> {
  if (sharedOperationalPage && !sharedOperationalPage.isClosed()) {
    return sharedOperationalPage;
  }

  const pages = context.pages().filter((page) => !page.isClosed());
  sharedOperationalPage =
    [...pages]
      .reverse()
      .find((page) => /(?:plataforma\.ticketlog\.com\.br|edenred\.io)/i.test(page.url())) ??
    pages.find((page) => page.url() !== "about:blank") ??
    pages[0] ??
    (await context.newPage());

  for (const page of pages) {
    if (page === sharedOperationalPage) continue;
    if (page.url() === "about:blank" || /plataforma\.ticketlog\.com\.br/i.test(page.url())) {
      await page.close().catch(() => undefined);
    }
  }

  return sharedOperationalPage;
}

export async function initializeBrowserStation(): Promise<void> {
  if (process.env.TICKETLOG_STATION_MODE !== "true") return;
  sharedContextPromise ??= launchSharedPersistentContext();
  const context = await sharedContextPromise;
  const page = await getSharedOperationalPage(context);
  if (page.url() === "about:blank") {
    await page.goto(process.env.TICKETLOG_HOME_URL ?? "https://plataforma.ticketlog.com.br/home");
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  }
}

export async function closeBrowserStation(): Promise<void> {
  if (!sharedContextPromise) return;
  const context = await sharedContextPromise;
  sharedContextPromise = undefined;
  sharedOperationalPage = undefined;
  await context.close();
}

export class BrowserTicketLogProvider implements TicketLogProvider {
  constructor(private readonly hooks: TicketLogProviderHooks = {}) {}

  async changeLimit(input: TicketLogLimitInput): Promise<TicketLogLimitResult> {
    this.assertRealExecutionAllowed(input);

    const session = await this.createBrowserSession();
    const context = session.context;
    const page = session.page;

    try {
      console.info({ requestId: input.requestId, plate: input.vehiclePlate }, "ticketlog.changeLimit:start");
      await this.emit({ status: "SESSION_CHECKING", currentUrl: page.url(), message: "Validando sessao Ticket Log" });
      await this.ensureAuthenticated(page);
      await this.emit({ status: "AUTOMATING", currentUrl: page.url(), message: "Alterando limite do veiculo" });
      console.info({ requestId: input.requestId, url: page.url() }, "ticketlog.changeLimit:authenticated");

      const fleet = new FleetVehiclePage(page);
      await fleet.gotoVehicleList();
      console.info({ requestId: input.requestId, url: page.url() }, "ticketlog.changeLimit:vehicle-list-open");

      const search = await fleet.searchPlate(input.vehiclePlate);
      console.info({ requestId: input.requestId, search }, "ticketlog.changeLimit:plate-search-result");
      if (search.count === 0) throw new ManualInterventionError("PLATE_NOT_FOUND");
      if (search.count > 1) throw new ManualInterventionError("MULTIPLE_PLATE_RESULTS");
      if (normalizePlate(search.foundPlate ?? "") !== normalizePlate(input.vehiclePlate)) {
        throw new ManualInterventionError("PLATE_MISMATCH");
      }

      await fleet.openPlate(input.vehiclePlate);
      console.info({ requestId: input.requestId, url: page.url() }, "ticketlog.changeLimit:plate-opened");

      if (await fleet.isBlocked()) {
        console.info({ requestId: input.requestId }, "ticketlog.changeLimit:vehicle-blocked");
        await fleet.unblockVehicle();
        console.info({ requestId: input.requestId }, "ticketlog.changeLimit:vehicle-unblocked");
      }

      const previousLimit = await fleet.readCurrentLimit();
      await this.hooks.onPreviousLimitRead?.({
        requestId: input.requestId,
        previousLimit,
      });
      console.info({ requestId: input.requestId, previousLimit }, "ticketlog.changeLimit:previous-limit");
      let platformResult: string;
      let newLimit: number | null = null;

      try {
        const confirmation = await fleet.addTemporaryLimit({
          plate: input.vehiclePlate,
          amount: input.requestedAmount,
          reason: ".",
        });
        platformResult = confirmation.platformResult;
        newLimit = confirmation.newLimit;
        this.assertLimitChangeConfirmation({
          requestId: input.requestId,
          previousLimit,
          requestedAmount: input.requestedAmount,
          confirmation,
        });
      } catch (error) {
        if (!(error instanceof IndeterminateResultError)) throw error;

        newLimit = await this.pollLimitAfterAmbiguousSubmission({
          fleet,
          vehiclePlate: input.vehiclePlate,
          previousLimit,
          requestedAmount: input.requestedAmount,
        });
        const expectedLimit =
          previousLimit !== null ? Number((previousLimit + Number(input.requestedAmount)).toFixed(2)) : null;
        const deltaMatches =
          previousLimit !== null &&
          newLimit !== null &&
          Math.abs((newLimit - previousLimit) - Number(input.requestedAmount)) < 0.01;
        const expectedMatches = expectedLimit !== null && newLimit !== null && Math.abs(newLimit - expectedLimit) < 0.01;

        if (!deltaMatches && !expectedMatches) {
          throw error;
        }

        platformResult = "ALTERACAO_CONFIRMADA_POR_LEITURA_DO_LIMITE";
        console.warn(
          { requestId: input.requestId, previousLimit, newLimit, expectedLimit, originalError: error.message },
          "ticketlog.changeLimit:confirmation-recovered-from-limit-read",
        );
      }

      console.info({ requestId: input.requestId, platformResult }, "ticketlog.changeLimit:limit-changed");
      const verifiedLimit =
        platformResult === "ALTERACAO_CONFIRMADA_POR_LEITURA_DO_LIMITE" && newLimit !== null
          ? newLimit
          : await this.pollLimitAfterConfirmedSubmission({
              fleet,
              vehiclePlate: input.vehiclePlate,
            });
      if (verifiedLimit !== null) {
        const expectedLimit =
          previousLimit !== null ? Number((previousLimit + Number(input.requestedAmount)).toFixed(2)) : null;
        if (expectedLimit !== null && Math.abs(verifiedLimit - expectedLimit) >= 0.01) {
          throw new IndeterminateResultError(
            `LIMIT_READBACK_DIVERGED_AFTER_CONFIRMATION:expected=${expectedLimit}:current=${verifiedLimit}`,
          );
        }
        newLimit = verifiedLimit;
        platformResult =
          platformResult === "ALTERACAO_CONFIRMADA_PELA_TELA_DE_RESULTADO"
            ? "ALTERACAO_CONFIRMADA_PELA_TELA_E_LEITURA_DO_LIMITE"
            : platformResult;
      } else if (newLimit === null) {
        throw new IndeterminateResultError("LIMIT_READBACK_NOT_AVAILABLE_AFTER_CONFIRMATION");
      }
      console.info({ requestId: input.requestId, newLimit }, "ticketlog.changeLimit:new-limit");

      await this.saveStorageState(context);
      console.info({ requestId: input.requestId }, "ticketlog.changeLimit:done");

      return {
        previousLimit,
        addedAmount: input.requestedAmount,
        newLimit,
        platformResult,
      };
    } finally {
      await session.close();
    }
  }

  async readCurrentLimit(
    input: Pick<TicketLogLimitInput, "requestId" | "vehiclePlate">,
  ): Promise<number | null> {
    this.assertEvaExecutionAllowed(input.vehiclePlate);

    const session = await this.createBrowserSession();
    const context = session.context;
    const page = session.page;
    try {
      await this.emit({ status: "SESSION_CHECKING", currentUrl: page.url(), message: "Validando sessao Ticket Log" });
      await this.ensureAuthenticated(page);
      await this.emit({ status: "AUTOMATING", currentUrl: page.url(), message: "Conferindo limite atual" });

      const fleet = new FleetVehiclePage(page);
      await fleet.gotoVehicleList();
      const search = await fleet.searchPlate(input.vehiclePlate);
      if (search.count === 0) throw new ManualInterventionError("PLATE_NOT_FOUND");
      if (search.count > 1) throw new ManualInterventionError("MULTIPLE_PLATE_RESULTS");
      if (normalizePlate(search.foundPlate ?? "") !== normalizePlate(input.vehiclePlate)) {
        throw new ManualInterventionError("PLATE_MISMATCH");
      }

      await fleet.openPlate(input.vehiclePlate);
      const currentLimit = await fleet.readCurrentLimit();
      console.info(
        { requestId: input.requestId, plate: input.vehiclePlate, currentLimit },
        "ticketlog.readCurrentLimit:completed",
      );
      await this.saveStorageState(context);
      return currentLimit;
    } finally {
      await session.close();
    }
  }

  async releaseEvaOnly(input: Pick<TicketLogLimitInput, "vehiclePlate">): Promise<void> {
    this.assertEvaExecutionAllowed(input.vehiclePlate);

    const session = await this.createBrowserSession();
    const context = session.context;
    const page = session.page;
    try {
      console.info({ plate: input.vehiclePlate }, "ticketlog.releaseEva:start");
      await this.emit({ status: "SESSION_CHECKING", currentUrl: page.url(), message: "Validando sessao para EVA" });
      await this.ensureAuthenticated(page);
      await this.emit({ status: "AUTOMATING", currentUrl: page.url(), message: "Liberando restricao pela EVA" });
      await this.openEvaHostPage(page);
      console.info({ plate: input.vehiclePlate, url: page.url() }, "ticketlog.releaseEva:host-open");
      const eva = new EvaPage(page);
      await eva.open();
      console.info({ plate: input.vehiclePlate }, "ticketlog.releaseEva:panel-open");
      await eva.releaseFuelRestriction(input.vehiclePlate);
      console.info({ plate: input.vehiclePlate }, "ticketlog.releaseEva:released");
      await this.saveStorageState(context);
    } finally {
      await session.close();
    }
  }

  private async createBrowserSession(): Promise<BrowserSession> {
    const headless = process.env.TICKETLOG_HEADLESS !== "false";
    const userDataDir = resolveUserDataDir();
    const stationMode = process.env.TICKETLOG_STATION_MODE === "true";

    if (stationMode) {
      if (!userDataDir) {
        throw new ManualInterventionError("TICKETLOG_USER_DATA_DIR_REQUIRED_FOR_STATION");
      }
      if (!sharedContextPromise) {
        sharedContextPromise = launchSharedPersistentContext();
      }
      const context = await sharedContextPromise;
      return {
        context,
        page: await getSharedOperationalPage(context),
        close: async () => undefined,
      };
    }

    const canUsePersistentProfile = userDataDir ? await hasUserDataDirState() : false;

    if (userDataDir && canUsePersistentProfile) {
      const context = await this.launchPersistentContext(userDataDir, headless);
      return {
        context,
        page: context.pages()[0] ?? (await context.newPage()),
        close: () => context.close(),
      };
    }

    const browser = await chromium.launch({ headless });
    const context = await this.createContext(browser);
    return {
      context,
      page: await context.newPage(),
      close: () => browser.close(),
    };
  }

  private async launchPersistentContext(userDataDir: string, headless: boolean): Promise<BrowserContext> {
    await mkdir(userDataDir, { recursive: true });
    return chromium.launchPersistentContext(userDataDir, {
      headless,
      viewport: headless ? undefined : null,
      args: browserLaunchArgs(headless),
    });
  }

  private async createContext(browser: Browser): Promise<BrowserContext> {
    const storageState = resolveStorageStatePath();
    if (!storageState) return browser.newContext();
    if (!(await hasStorageStateFile())) return browser.newContext();
    return browser.newContext({ storageState });
  }

  private async saveStorageState(context: BrowserContext): Promise<void> {
    const storageState = resolveStorageStatePath();
    if (!storageState) return;
    await mkdir(dirname(storageState), { recursive: true });
    await context.storageState({ path: storageState });
  }

  private async openEvaHostPage(page: Page): Promise<void> {
    const homeUrl = process.env.TICKETLOG_HOME_URL ?? "https://plataforma.ticketlog.com.br/home";
    const fleet = new FleetVehiclePage(page);

    if (process.env.TICKETLOG_STATION_MODE === "true") {
      await fleet.gotoHome();
      return;
    }

    const navigatedThroughUi = await fleet
      .gotoHome()
      .then(() => true)
      .catch(() => false);
    if (navigatedThroughUi) return;

    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  }

  private async readLimitAfterSubmission(fleet: FleetVehiclePage, vehiclePlate: string): Promise<number | null> {
    await fleet.gotoVehicleList();
    const search = await fleet.searchPlate(vehiclePlate);
    if (search.count === 0) throw new ManualInterventionError("PLATE_NOT_FOUND_AFTER_LIMIT_SUBMISSION");
    if (search.count > 1) throw new ManualInterventionError("MULTIPLE_PLATE_RESULTS_AFTER_LIMIT_SUBMISSION");
    if (normalizePlate(search.foundPlate ?? "") !== normalizePlate(vehiclePlate)) {
      throw new ManualInterventionError("PLATE_MISMATCH_AFTER_LIMIT_SUBMISSION");
    }

    await fleet.openPlate(vehiclePlate);
    return fleet.readCurrentLimit();
  }

  private async pollLimitAfterAmbiguousSubmission(input: {
    fleet: FleetVehiclePage;
    vehiclePlate: string;
    previousLimit: number | null;
    requestedAmount: number;
  }): Promise<number | null> {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    return this.readLimitAfterSubmission(input.fleet, input.vehiclePlate).catch(() => null);
  }

  private async pollLimitAfterConfirmedSubmission(input: {
    fleet: FleetVehiclePage;
    vehiclePlate: string;
  }): Promise<number | null> {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    return this.readLimitAfterSubmission(input.fleet, input.vehiclePlate).catch((error) => {
      console.warn(
        {
          plate: input.vehiclePlate,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        "ticketlog.changeLimit:confirmed-result-readback-unavailable",
      );
      return null;
    });
  }

  private assertLimitChangeConfirmation(input: {
    requestId: string;
    previousLimit: number | null;
    requestedAmount: number;
    confirmation: {
      previousLimit: number | null;
      addedAmount: number | null;
      newLimit: number | null;
    };
  }): void {
    const expectedLimit =
      input.previousLimit !== null
        ? Number((input.previousLimit + Number(input.requestedAmount)).toFixed(2))
        : null;
    const mismatches = [
      input.previousLimit !== null &&
      input.confirmation.previousLimit !== null &&
      Math.abs(input.confirmation.previousLimit - input.previousLimit) >= 0.01
        ? "previous"
        : null,
      input.confirmation.addedAmount !== null &&
      Math.abs(input.confirmation.addedAmount - Number(input.requestedAmount)) >= 0.01
        ? "added"
        : null,
      expectedLimit !== null &&
      input.confirmation.newLimit !== null &&
      Math.abs(input.confirmation.newLimit - expectedLimit) >= 0.01
        ? "current"
        : null,
    ].filter(Boolean);

    if (mismatches.length > 0) {
      throw new IndeterminateResultError(
        `LIMIT_RESULT_TABLE_DIVERGED:${mismatches.join(",")}:request=${input.requestId}`,
      );
    }
  }

  private async ensureAuthenticated(page: Page): Promise<void> {
    const loginUrl = process.env.TICKETLOG_LOGIN_URL;
    const allowManualLogin = process.env.TICKETLOG_ALLOW_MANUAL_LOGIN === "true";
    const homeUrl = process.env.TICKETLOG_HOME_URL ?? "https://plataforma.ticketlog.com.br/home";
    const targetUrl = loginUrl ?? homeUrl;

    if (await this.isAuthenticatedPlatformPage(page)) {
      await this.emit({ status: "SESSION_READY", currentUrl: page.url(), message: "Sessao autenticada" });
      return;
    }

    if (
      page.url() === "about:blank" ||
      !/(?:plataforma\.ticketlog\.com\.br|edenred\.io)/i.test(page.url())
    ) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    }

    if (allowManualLogin && (await this.requiresHumanChallenge(page))) {
      await this.emit({
        status: "AUTH_REQUIRED",
        currentUrl: page.url(),
        challengeType: this.challengeType(page.url()),
        message: "Aguardando operador concluir autenticacao Edenred",
      });
      await this.waitForManualLogin(page);
      await this.emit({ status: "SESSION_READY", currentUrl: page.url(), message: "Sessao autenticada" });
      return;
    }

    if (await page.getByText(/captcha|mfa|autenticador|token|c.digo/i).first().isVisible().catch(() => false)) {
      throw new ManualInterventionError("UNEXPECTED_CAPTCHA_OR_MFA");
    }

    const username = process.env.TICKETLOG_USERNAME;
    const password = process.env.TICKETLOG_PASSWORD;
    const userField = page.getByLabel(/usu.rio|e-mail|email|login/i).first();
    const passwordField = page.getByLabel(/senha/i).first();
    const userFieldVisible = await userField.isVisible().catch(() => false);
    const passwordFieldVisible = await passwordField.isVisible().catch(() => false);

    if ((userFieldVisible || passwordFieldVisible) && (!username || !password)) {
      if (allowManualLogin) {
        await this.emit({
          status: "AUTH_REQUIRED",
          currentUrl: page.url(),
          challengeType: "LOGIN",
          message: "Aguardando operador concluir login Ticket Log",
        });
        await this.waitForManualLogin(page);
        await this.emit({ status: "SESSION_READY", currentUrl: page.url(), message: "Sessao autenticada" });
        return;
      }
      throw new ManualInterventionError("TICKETLOG_CREDENTIALS_REQUIRED_FOR_LOGIN");
    }

    if (userFieldVisible) {
      const safeUsername = username as string;
      const safePassword = password as string;
      await userField.fill(safeUsername);
      await passwordField.fill(safePassword);
      await page.getByRole("button", { name: /entrar|acessar|login/i }).click();
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await this.waitForPostLoginNavigation(page);
      if (allowManualLogin && (await this.requiresHumanChallenge(page))) {
        await this.emit({
          status: "AUTH_REQUIRED",
          currentUrl: page.url(),
          challengeType: this.challengeType(page.url()),
          message: "Aguardando operador concluir desafio Edenred",
        });
        await this.waitForManualLogin(page);
        await this.emit({ status: "SESSION_READY", currentUrl: page.url(), message: "Sessao autenticada" });
        return;
      }
      if (await page.getByText(/captcha|mfa|autenticador|token|c.digo/i).first().isVisible().catch(() => false)) {
        throw new ManualInterventionError("UNEXPECTED_CAPTCHA_OR_MFA");
      }
    }

    const loginFieldStillVisible = await page.getByLabel(/usu.rio|e-mail|email|login/i).first().isVisible().catch(() => false);
    const passwordFieldStillVisible = await page.getByLabel(/senha/i).first().isVisible().catch(() => false);
    if (loginFieldStillVisible || passwordFieldStillVisible) {
      throw new ManualInterventionError("TICKETLOG_SESSION_NOT_AUTHENTICATED");
    }
    await this.emit({ status: "SESSION_READY", currentUrl: page.url(), message: "Sessao autenticada" });
  }

  private async waitForPostLoginNavigation(page: Page, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await this.isAuthenticatedPlatformPage(page)) || (await this.requiresHumanChallenge(page))) {
        return;
      }
      await page.waitForTimeout(500);
    }
  }

  private async isAuthenticatedPlatformPage(page: Page): Promise<boolean> {
    if (!/plataforma\.ticketlog\.com\.br/i.test(page.url())) return false;
    if (await this.requiresHumanChallenge(page)) return false;

    const loginVisible =
      (await page.getByLabel(/usu.rio|e-mail|email|login/i).first().isVisible().catch(() => false)) ||
      (await page.getByLabel(/senha/i).first().isVisible().catch(() => false));
    if (loginVisible) return false;

    const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    return /in.cio|home|cadastros|registers|acesso r.pido|quick access|altera..o de limite|detalhes do ve.culo/i.test(
      bodyText,
    );
  }

  private challengeType(url: string): string {
    if (/trusted-device/i.test(url)) return "TRUSTED_DEVICE";
    if (/otp/i.test(url)) return "OTP_SMS";
    if (/captcha/i.test(url)) return "CAPTCHA";
    return "AUTHENTICATION";
  }

  private async emit(event: TicketLogOperationalEvent): Promise<void> {
    await this.hooks.onOperationalEvent?.(event);
  }

  private async requiresHumanChallenge(page: Page): Promise<boolean> {
    const url = page.url();
    if (/edenred\.io\/web\/session\/step\//i.test(url)) return true;

    const bodyText = await page.locator("body").innerText().catch(() => "");
    return /c.digo de verifica..o|receber c.digo por e-mail|solicitar novo c.digo|captcha|autenticador|mfa/i.test(
      bodyText,
    );
  }

  private async waitForManualLogin(page: Page): Promise<void> {
    const timeoutMs = Number(process.env.TICKETLOG_MANUAL_LOGIN_TIMEOUT_MS ?? 15 * 60_000);

    console.error(
      "TICKETLOG_ALLOW_MANUAL_LOGIN=true: conclua login, OTP/SMS/MFA/reCAPTCHA no navegador aberto; depois pressione Enter no terminal quando estiver realmente dentro da Ticket Log.",
    );

    if (process.env.TICKETLOG_MANUAL_LOGIN_CONTINUE !== "auto" && process.stdin.isTTY) {
      await waitForEnter("Pressione Enter apos concluir login/codigo no navegador...");
    } else {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (page.isClosed()) {
          throw new ManualInterventionError("BROWSER_CLOSED_DURING_MANUAL_LOGIN");
        }

        const loginFieldStillVisible = await page.getByLabel(/usu.rio|e-mail|email|login/i).first().isVisible().catch(() => false);
        const passwordFieldStillVisible = await page.getByLabel(/senha/i).first().isVisible().catch(() => false);
        const challengeStillVisible = await this.requiresHumanChallenge(page);
        const platformShellVisible = await page.getByText(/in.cio|acesso r.pido|sou log|ticket log|ve.culos|placa/i).first().isVisible().catch(() => false);

        if (!loginFieldStillVisible && !passwordFieldStillVisible && !challengeStillVisible && platformShellVisible) {
          break;
        }

        await page.waitForTimeout(1500);
      }
    }

    if (page.isClosed()) {
      throw new ManualInterventionError("BROWSER_CLOSED_DURING_MANUAL_LOGIN");
    }

    const loginFieldStillVisible = await page.getByLabel(/usu.rio|e-mail|email|login/i).first().isVisible().catch(() => false);
    const passwordFieldStillVisible = await page.getByLabel(/senha/i).first().isVisible().catch(() => false);
    const challengeStillVisible = await this.requiresHumanChallenge(page);
    const platformShellVisible = await page
      .getByText(/in.cio|acesso r.pido|sou log|ticket log|ve.culos|placa|cadastros/i)
      .first()
      .isVisible()
      .catch(() => false);

    if (loginFieldStillVisible || passwordFieldStillVisible || challengeStillVisible || !platformShellVisible) {
      throw new ManualInterventionError("MANUAL_LOGIN_NOT_CONFIRMED");
    }

    await this.saveStorageState(page.context());
  }

  private assertRealExecutionAllowed(input: TicketLogLimitInput): void {
    if (process.env.TICKETLOG_REAL_EXECUTION !== "true") {
      throw new ManualInterventionError("REAL_EXECUTION_DISABLED");
    }

    const normalizedPlate = normalizePlate(input.vehiclePlate);
    const allowedPlates = this.getAllowedPlates();
    if (allowedPlates.size > 0 && !allowedPlates.has(normalizedPlate)) {
      throw new ManualInterventionError("REAL_EXECUTION_PLATE_NOT_ALLOWED");
    }

    const allowedAmount = process.env.TICKETLOG_REAL_ALLOWED_AMOUNT;
    if (allowedAmount) {
      const parsedAllowedAmount = Number(allowedAmount);
      if (!Number.isFinite(parsedAllowedAmount) || parsedAllowedAmount <= 0) {
        throw new ManualInterventionError("REAL_EXECUTION_ALLOWED_AMOUNT_INVALID");
      }

      if (Number(input.requestedAmount) !== parsedAllowedAmount) {
        throw new ManualInterventionError("REAL_EXECUTION_AMOUNT_NOT_ALLOWED");
      }
    }
  }

  private assertEvaExecutionAllowed(vehiclePlate: string): void {
    if (process.env.TICKETLOG_REAL_EXECUTION !== "true") {
      throw new ManualInterventionError("REAL_EXECUTION_DISABLED");
    }

    const normalizedPlate = normalizePlate(vehiclePlate);
    const allowedPlates = this.getAllowedPlates();
    if (allowedPlates.size > 0 && !allowedPlates.has(normalizedPlate)) {
      throw new ManualInterventionError("REAL_EXECUTION_PLATE_NOT_ALLOWED");
    }
  }

  private getAllowedPlates(): Set<string> {
    const raw = process.env.TICKETLOG_REAL_ALLOWED_PLATES ?? "";
    return new Set(
      raw
        .split(",")
        .map((plate) => plate.trim())
        .filter(Boolean)
        .map((plate) => normalizePlate(plate)),
    );
  }
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
