import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { normalizePlate, ManualInterventionError } from "@ticketlog/domain";
import type { TicketLogLimitInput, TicketLogLimitResult, TicketLogProvider } from "../provider.js";
import { EvaPage } from "./pages/EvaPage.js";
import { FleetVehiclePage } from "./pages/FleetVehiclePage.js";
import { hasStorageStateFile, hasUserDataDirState, resolveStorageStatePath, resolveUserDataDir } from "./sessionConfig.js";

interface BrowserSession {
  context: BrowserContext;
  close(): Promise<void>;
}

export class BrowserTicketLogProvider implements TicketLogProvider {
  async changeLimit(input: TicketLogLimitInput): Promise<TicketLogLimitResult> {
    this.assertRealExecutionAllowed(input);

    const session = await this.createBrowserSession();
    const context = session.context;
    const page = await context.newPage();

    try {
      await this.ensureAuthenticated(page);

      const fleet = new FleetVehiclePage(page);
      await fleet.gotoVehicleList();

      const search = await fleet.searchPlate(input.vehiclePlate);
      if (search.count === 0) throw new ManualInterventionError("PLATE_NOT_FOUND");
      if (search.count > 1) throw new ManualInterventionError("MULTIPLE_PLATE_RESULTS");
      if (normalizePlate(search.foundPlate ?? "") !== normalizePlate(input.vehiclePlate)) {
        throw new ManualInterventionError("PLATE_MISMATCH");
      }

      await fleet.openPlate(input.vehiclePlate);

      if (await fleet.isBlocked()) {
        await fleet.unblockVehicle();
      }

      const previousLimit = await fleet.readCurrentLimit();
      const platformResult = await fleet.addTemporaryLimit({
        plate: input.vehiclePlate,
        amount: input.requestedAmount,
        reason: ".",
      });
      const newLimit = await fleet.readCurrentLimit();

      await this.saveStorageState(context);

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

  async releaseEvaOnly(input: Pick<TicketLogLimitInput, "vehiclePlate">): Promise<void> {
    this.assertEvaExecutionAllowed(input.vehiclePlate);

    const session = await this.createBrowserSession();
    const context = session.context;
    const page = await context.newPage();
    try {
      await this.ensureAuthenticated(page);
      await this.openEvaHostPage(page);
      const eva = new EvaPage(page);
      await eva.open();
      await eva.releaseFuelRestriction(input.vehiclePlate);
      await this.saveStorageState(context);
    } finally {
      await session.close();
    }
  }

  private async createBrowserSession(): Promise<BrowserSession> {
    const headless = process.env.TICKETLOG_HEADLESS !== "false";
    const userDataDir = resolveUserDataDir();
    const canUsePersistentProfile = userDataDir ? await hasUserDataDirState() : false;

    if (userDataDir && canUsePersistentProfile) {
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

    await page.goto(homeUrl);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  }

  private async ensureAuthenticated(page: { goto(url: string): Promise<unknown>; getByLabel(label: RegExp): any; getByRole(role: string, options: any): any; getByText(text: RegExp): any }): Promise<void> {
    const loginUrl = process.env.TICKETLOG_LOGIN_URL;
    if (!loginUrl) return;

    await page.goto(loginUrl);
    if (await page.getByText(/captcha|mfa|autenticador|c.digo/i).first().isVisible().catch(() => false)) {
      throw new ManualInterventionError("UNEXPECTED_CAPTCHA_OR_MFA");
    }

    const username = process.env.TICKETLOG_USERNAME;
    const password = process.env.TICKETLOG_PASSWORD;
    if (!username || !password) return;

    const userField = page.getByLabel(/usu.rio|e-mail|email|login/i);
    if (await userField.isVisible().catch(() => false)) {
      await userField.fill(username);
      await page.getByLabel(/senha/i).fill(password);
      await page.getByRole("button", { name: /entrar|acessar|login/i }).click();
    }

    const loginFieldStillVisible = await page.getByLabel(/usu.rio|e-mail|email|login/i).first().isVisible().catch(() => false);
    const passwordFieldStillVisible = await page.getByLabel(/senha/i).first().isVisible().catch(() => false);
    if (loginFieldStillVisible || passwordFieldStillVisible) {
      throw new ManualInterventionError("TICKETLOG_SESSION_NOT_AUTHENTICATED");
    }
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
