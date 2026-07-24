import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { normalizePlate, ManualInterventionError } from "@ticketlog/domain";
import type { TicketLogLimitInput, TicketLogLimitResult, TicketLogProvider } from "../provider.js";
import { EvaPage } from "./pages/EvaPage.js";
import { FleetVehiclePage } from "./pages/FleetVehiclePage.js";

export class BrowserTicketLogProvider implements TicketLogProvider {
  async changeLimit(input: TicketLogLimitInput): Promise<TicketLogLimitResult> {
    const browser = await chromium.launch({ headless: process.env.TICKETLOG_HEADLESS !== "false" });
    const context = await this.createContext(browser);
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

      await context.storageState({ path: process.env.TICKETLOG_SESSION_STORAGE_PATH });

      return {
        previousLimit,
        addedAmount: input.requestedAmount,
        newLimit,
        platformResult,
      };
    } finally {
      await browser.close();
    }
  }

  async releaseEvaOnly(input: Pick<TicketLogLimitInput, "vehiclePlate">): Promise<void> {
    const browser = await chromium.launch({ headless: process.env.TICKETLOG_HEADLESS !== "false" });
    const context = await this.createContext(browser);
    const page = await context.newPage();
    try {
      await this.ensureAuthenticated(page);
      const eva = new EvaPage(page);
      await eva.open();
      await eva.releaseFuelRestriction(input.vehiclePlate);
      await context.storageState({ path: process.env.TICKETLOG_SESSION_STORAGE_PATH });
    } finally {
      await browser.close();
    }
  }

  private async createContext(browser: Browser): Promise<BrowserContext> {
    const storageState = process.env.TICKETLOG_SESSION_STORAGE_PATH;
    return browser.newContext(storageState ? { storageState } : {});
  }

  private async ensureAuthenticated(page: { goto(url: string): Promise<unknown>; getByLabel(label: RegExp): any; getByRole(role: string, options: any): any; getByText(text: RegExp): any }): Promise<void> {
    const loginUrl = process.env.TICKETLOG_LOGIN_URL;
    if (!loginUrl) return;

    await page.goto(loginUrl);
    if (await page.getByText(/captcha|mfa|autenticador|c[oó]digo/i).first().isVisible().catch(() => false)) {
      throw new ManualInterventionError("UNEXPECTED_CAPTCHA_OR_MFA");
    }

    const username = process.env.TICKETLOG_USERNAME;
    const password = process.env.TICKETLOG_PASSWORD;
    if (!username || !password) return;

    const userField = page.getByLabel(/usu[aá]rio|e-mail|email|login/i);
    if (await userField.isVisible().catch(() => false)) {
      await userField.fill(username);
      await page.getByLabel(/senha/i).fill(password);
      await page.getByRole("button", { name: /entrar|acessar|login/i }).click();
    }
  }
}
