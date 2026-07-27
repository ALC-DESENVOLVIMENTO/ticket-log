import { expect, type Page } from "@playwright/test";
import { normalizePlate } from "@ticketlog/domain";

export class EvaPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.getByRole("button", { name: /eva|assistente virtual/i }).click();
    await expect(this.page.getByText(/eva|assistente/i).first()).toBeVisible();
  }

  async releaseFuelRestriction(plate: string): Promise<void> {
    await this.page.getByText(/transa..es/i).click();
    await this.page.getByText(/liberar abastecimento.*restri..o/i).click();
    await this.page.getByRole("textbox").last().fill(normalizePlate(plate));
    await this.page.getByRole("button", { name: /enviar|confirmar/i }).click();

    await expect(
      this.page.getByText(/libera..o conclu.da|abastecimento liberado|restri..o liberada/i).first(),
    ).toBeVisible();
  }
}
