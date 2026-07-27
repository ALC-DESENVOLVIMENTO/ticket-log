import { expect, type Locator, type Page } from "@playwright/test";
import { ManualInterventionError, normalizePlate } from "@ticketlog/domain";

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
    const panel = await this.getPanel();
    await this.findVisible([
      panel.getByRole("button", { name: /^transa..es$/i }),
      panel.getByText(/^\s*transa..es\s*$/i),
    ]).then((locator) => locator.click());

    const updatedPanel = await this.getPanel();
    await this.findVisible([
      updatedPanel.getByRole("button", { name: /liberar abastecimento.*restri..o/i }),
      updatedPanel.getByText(/^\s*liberar abastecimento.*restri..o\s*$/i),
    ]).then((locator) => locator.click());

    const textbox = this.page.getByRole("textbox").last();
    await textbox.fill(normalizePlate(plate));
    await this.findVisible([
      (await this.getPanel()).getByRole("button", { name: /enviar|confirmar/i }),
      this.page.locator("button").last(),
    ]).then((locator) => locator.click());

    await expect(
      this.page.getByText(/libera..o conclu.da|abastecimento liberado|restri..o liberada|fiz a libera..o da restri..o/i).first(),
    ).toBeVisible();
  }

  private async getPanel(): Promise<Locator> {
    const textbox = this.page.getByRole("textbox").last();
    await expect(textbox).toBeVisible({ timeout: 15_000 });
    const panel = textbox.locator("xpath=ancestor::*[contains(., 'EVA')][1]");
    if (await panel.isVisible().catch(() => false)) return panel;
    throw new ManualInterventionError("EVA_PANEL_NOT_FOUND");
  }

  private async findVisible(candidates: Locator[]): Promise<Locator> {
    for (const candidate of candidates) {
      const locator = candidate.first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }

    throw new ManualInterventionError("VISIBLE_LOCATOR_NOT_FOUND");
  }
}
