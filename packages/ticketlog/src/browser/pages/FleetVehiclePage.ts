import { expect, type Page } from "@playwright/test";
import { formatCurrencyInput, normalizePlate } from "@ticketlog/domain";

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
    await this.page.getByLabel(/placa/i).fill(normalized);
    await this.page.getByRole("button", { name: /pesquisar|buscar|filtrar/i }).click();

    const rows = this.page.getByRole("row").filter({ hasText: normalized });
    const count = await rows.count();
    return { count, foundPlate: count === 1 ? normalized : undefined };
  }

  async openPlate(plate: string): Promise<void> {
    const normalized = normalizePlate(plate);
    await this.page.getByRole("link", { name: new RegExp(normalized, "i") }).click();
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
    const label = this.page.getByText(/limite atual/i).first();
    if (!(await label.isVisible().catch(() => false))) return null;
    const text = await label.locator("..").innerText();
    const match = text.replace(/\./g, "").replace(",", ".").match(/(\d+(?:\.\d{2})?)/);
    return match ? Number(match[1]) : null;
  }

  async addTemporaryLimit(input: { plate: string; amount: number; reason: string }): Promise<string> {
    await this.page.getByRole("button", { name: /alterar limite/i }).click();
    await this.page.getByLabel(/adicionar.*limite atual/i).check();
    await this.page.getByLabel(/valor/i).fill(formatCurrencyInput(input.amount));
    await this.page.getByLabel(/somente para o per.odo/i).check();
    await this.page.getByLabel(/motivo/i).fill(input.reason);
    await this.page.getByRole("checkbox", { name: new RegExp(normalizePlate(input.plate), "i") }).check();
    await this.page.getByRole("button", { name: /^alterar$/i }).click();

    const confirmation = this.page.getByText(/alterad[oa].*sucesso|limite.*atualizad[oa]/i).first();
    await expect(confirmation).toBeVisible();
    return confirmation.innerText();
  }
}
