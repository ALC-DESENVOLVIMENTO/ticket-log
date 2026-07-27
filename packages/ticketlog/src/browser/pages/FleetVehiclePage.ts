import { expect, type Locator, type Page } from "@playwright/test";
import { formatCurrencyInput, IndeterminateResultError, ManualInterventionError, normalizePlate } from "@ticketlog/domain";

export class FleetVehiclePage {
  constructor(private readonly page: Page) {}

  async gotoVehicleList(): Promise<void> {
    const url = process.env.TICKETLOG_VEHICLE_LIST_URL;
    if (!url) throw new Error("TICKETLOG_VEHICLE_LIST_URL is required");
    await this.page.goto(url);
    await expect(this.page.getByText(/ve.culos|placa/i).first()).toBeVisible();
  }

  async searchPlate(plate: string): Promise<{ count: number; foundPlate?: string }> {
    const normalized = normalizePlate(plate);
    const plateSearch = await this.findVisible([
      this.page.getByLabel(/placa|identificador/i),
      this.page.getByPlaceholder(/placa|identificador|pesquise|busque/i),
      this.page.getByRole("textbox").filter({ hasText: /placa|identificador/i }),
      this.page.getByRole("textbox").first(),
    ]);

    await plateSearch.fill(normalized);
    const searchButton = this.page.getByRole("button", { name: /pesquisar|buscar|filtrar/i }).first();
    if (await searchButton.isVisible().catch(() => false)) {
      await searchButton.click();
    } else {
      await plateSearch.press("Enter");
    }

    const rows = this.page.getByRole("row").filter({ hasText: normalized });
    const count = await rows.count();
    return { count, foundPlate: count === 1 ? normalized : undefined };
  }

  async openPlate(plate: string): Promise<void> {
    const normalized = normalizePlate(plate);
    const plateLink = await this.findVisible([
      this.page.getByRole("link", { name: new RegExp(normalized, "i") }),
      this.page.getByText(normalized, { exact: false }).first(),
    ]);
    await plateLink.click();
    await expect(this.page.getByText(normalized)).toBeVisible();
  }

  async isBlocked(): Promise<boolean> {
    return this.page.getByText(/bloquead[oa]/i).first().isVisible();
  }

  async unblockVehicle(): Promise<void> {
    await this.page.getByRole("button", { name: /desbloquear/i }).click();
    await this.page.getByRole("button", { name: /confirmar|sim/i }).click();
    await expect(this.page.getByText(/desbloquead[oa].*sucesso|ativo/i)).toBeVisible();
  }

  async readCurrentLimit(): Promise<number | null> {
    const label = this.page.getByText(/limite atual|limite total/i).first();
    if (!(await label.isVisible().catch(() => false))) return null;
    const text = await label.locator("..").innerText();
    const match = text.replace(/\./g, "").replace(",", ".").match(/(\d+(?:\.\d{2})?)/);
    return match ? Number(match[1]) : null;
  }

  async addTemporaryLimit(input: { plate: string; amount: number; reason: string }): Promise<string> {
    await this.openChangeLimitForm();
    await this.page.getByLabel(/adicionar.*limite atual/i).check();
    const valueField = await this.findVisible([
      this.page.getByLabel(/valor para altera..o|valor/i),
      this.page.getByRole("textbox").filter({ hasText: /valor/i }),
      this.page.getByRole("spinbutton").first(),
    ]);
    await valueField.fill(formatCurrencyInput(input.amount));
    await this.page.getByLabel(/somente para o per.odo/i).check();
    await this.page.getByLabel(/motivo/i).fill(input.reason);

    const normalizedPlate = normalizePlate(input.plate);
    const row = this.page.getByRole("row").filter({ hasText: normalizedPlate });
    const rowCount = await row.count();
    if (rowCount !== 1) {
      throw new ManualInterventionError(
        rowCount === 0 ? "PLATE_ROW_NOT_FOUND_ON_LIMIT_FORM" : "MULTIPLE_PLATE_ROWS_ON_LIMIT_FORM",
      );
    }

    await row.first().getByRole("checkbox").check();
    await this.page.getByRole("button", { name: /^alterar$/i }).click();

    const confirmation = this.page.getByText(/alterad[oa].*sucesso|limite.*atualizad[oa]|opera..o.*sucesso/i).first();
    try {
      await expect(confirmation).toBeVisible({ timeout: 45_000 });
    } catch {
      throw new IndeterminateResultError("CHANGE_LIMIT_CONFIRMATION_NOT_FOUND");
    }
    return confirmation.innerText();
  }

  private async openChangeLimitForm(): Promise<void> {
    if (await this.page.getByText(/altera..o de limite/i).first().isVisible().catch(() => false)) {
      return;
    }

    const entrypoint = await this.findVisible([
      this.page.getByRole("button", { name: /altera..o de limite|alterar limite/i }),
      this.page.getByRole("link", { name: /altera..o de limite|alterar limite/i }),
      this.page.getByText(/altera..o de limite|alterar limite/i).first(),
    ]);

    await entrypoint.click();
    await expect(this.page.getByText(/altera..o de limite/i).first()).toBeVisible();
  }

  private async findVisible(candidates: Locator[]): Promise<Locator> {
    for (const candidate of candidates) {
      const locator = candidate.first();
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }

    throw new ManualInterventionError("VISIBLE_LOCATOR_NOT_FOUND");
  }
}
