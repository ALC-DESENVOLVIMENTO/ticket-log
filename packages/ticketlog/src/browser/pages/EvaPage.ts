import { expect, type Page } from "@playwright/test";
import { normalizePlate } from "@ticketlog/domain";

export class EvaPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    const evaButton = this.page.getByRole("button", { name: /eva|assistente virtual/i }).first();
    if (await evaButton.isVisible().catch(() => false)) {
      await evaButton.click();
    } else if (!(await this.page.getByText(/ol., sou a eva|assistente virtual/i).first().isVisible().catch(() => false))) {
      throw new Error("EVA_BUTTON_NOT_FOUND");
    }

    await expect(this.page.getByText(/eva|assistente/i).first()).toBeVisible();
  }

  async releaseFuelRestriction(plate: string): Promise<void> {
    await this.page.getByText(/transa..es/i).click();
    await this.page.getByText(/liberar abastecimento.*restri..o/i).click();
    await this.page.getByRole("textbox").last().fill(normalizePlate(plate));
    await this.page.getByRole("button", { name: /enviar|confirmar/i }).click();

    await expect(
      this.page.getByText(/libera..o conclu.da|abastecimento liberado|restri..o liberada|fiz a libera..o da restri..o/i).first(),
    ).toBeVisible();
  }
}
