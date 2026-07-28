import { expect, type Frame, type Locator, type Page } from "@playwright/test";
import { ManualInterventionError, normalizePlate } from "@ticketlog/domain";

export class EvaPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    if (await this.getEvaFrame(1_000)) return;

    const evaButton = await this.waitForVisible(
      [
        this.page.locator("#ge-fab, #gea-fab, #movebutton, #buttoneva").first(),
        this.page.locator("button.eva-button, button[aria-label='EVA']").first(),
        this.page.getByRole("button", { name: /eva|assistente virtual/i }).first(),
        this.page.locator("img#fotoeva, img[src*='eva' i], img[alt*='eva' i]").first(),
      ],
      30_000,
    ).catch(() => null);

    if (!evaButton) {
      throw new ManualInterventionError("EVA_BUTTON_NOT_FOUND");
    }

    await evaButton.click({ force: true });
    if (!(await this.getEvaFrame())) {
      throw new ManualInterventionError("EVA_PANEL_NOT_FOUND");
    }
  }

  async releaseFuelRestriction(plate: string): Promise<void> {
    const frame = await this.openReleaseFuelRestrictionFlow();
    const textbox = await this.findVisible([
      frame.getByRole("textbox").last(),
      frame.locator("textarea:visible").last(),
      frame.locator("input:visible").last(),
    ]);

    await textbox.fill(normalizePlate(plate));

    await this.findVisible([
      frame.getByRole("button", { name: /enviar|confirmar|send|confirm/i }),
      frame.locator("button:visible").last(),
    ]).then((locator) => locator.click());

    const confirmation = await this.waitForEvaConfirmation(frame);
    if (!confirmation) {
      throw new ManualInterventionError("EVA_RELEASE_CONFIRMATION_NOT_FOUND");
    }
  }

  async prepareFuelRestrictionDryRun(plate: string): Promise<void> {
    const frame = await this.openReleaseFuelRestrictionFlow();
    const textbox = await this.findVisible([
      frame.getByRole("textbox").last(),
      frame.locator("textarea:visible").last(),
      frame.locator("input:visible").last(),
    ]);

    await textbox.fill(normalizePlate(plate));
    await expect(textbox).toHaveValue(normalizePlate(plate));
    await expect(frame.locator("button:visible").last()).toBeVisible();
  }

  private async openReleaseFuelRestrictionFlow(): Promise<Frame> {
    await this.open();
    const frame = await this.requireEvaFrame();

    await this.clickEvaOption(frame, /^(?:transa..es|transactions)/i);
    await this.clickEvaOption(frame, /liberar abastecimento.*restri|release fuel.*restrict/i);
    return frame;
  }

  private async clickEvaOption(frame: Frame, name: RegExp): Promise<void> {
    const option = await this.waitForVisible([
      frame.getByRole("button", { name }),
      frame.getByText(name).first(),
    ]);

    await option.click({ force: true });
    await this.page.waitForTimeout(1_000);
  }

  private async requireEvaFrame(): Promise<Frame> {
    const frame = await this.getEvaFrame();
    if (!frame) throw new ManualInterventionError("EVA_PANEL_NOT_FOUND");
    return frame;
  }

  private async getEvaFrame(timeoutMs = 30_000): Promise<Frame | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of this.page.frames()) {
        const body = await frame.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
        if (frame.url().includes("eva-front.edenred.com.br")) return frame;
        if (/sou a eva|i am eva|digite sobre o que deseja falar|type what you want|digite aqui sua d.vida|type your question/i.test(body)) return frame;
      }

      await this.page.waitForTimeout(500);
    }

    return null;
  }

  private async waitForEvaConfirmation(frame: Frame): Promise<string | null> {
    const deadline = Date.now() + 60_000;
    const successPattern =
      /libera..o conclu.da|abastecimento liberado|restri..o liberada|fiz a libera..o da restri|release completed|fueling released|restriction released/i;

    while (Date.now() < deadline) {
      const body = await frame.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
      if (successPattern.test(body)) return body.slice(0, 500);
      await this.page.waitForTimeout(1_000);
    }

    return null;
  }

  private async waitForVisible(candidates: Locator[], timeoutMs = 20_000): Promise<Locator> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const candidate of candidates) {
        const locator = candidate.first();
        if (await locator.isVisible().catch(() => false)) return locator;
      }

      await this.page.waitForTimeout(500);
    }

    throw new ManualInterventionError("VISIBLE_LOCATOR_NOT_FOUND");
  }

  private async findVisible(candidates: Locator[]): Promise<Locator> {
    for (const candidate of candidates) {
      const locator = candidate.first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }

    throw new ManualInterventionError("VISIBLE_LOCATOR_NOT_FOUND");
  }
}
