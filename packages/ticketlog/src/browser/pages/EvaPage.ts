import { expect, type Frame, type Locator, type Page } from "@playwright/test";
import { ManualInterventionError, normalizePlate } from "@ticketlog/domain";
import {
  isEvaFrameCandidate,
  isEvaReleaseConfirmation,
  ticketLogUi,
} from "../uiMap.js";

export class EvaPage {
  constructor(private readonly page: Page) {}

  async isAvailable(timeoutMs = 2_500): Promise<boolean> {
    if (await this.getEvaFrame(250)) return true;
    return (await this.findEvaLauncher(timeoutMs)) !== null;
  }

  async open(): Promise<void> {
    if (await this.getEvaFrame(500)) return;

    const evaButton = await this.findEvaLauncher(8_000);
    if (!evaButton) {
      throw new ManualInterventionError("EVA_BUTTON_NOT_FOUND");
    }

    await evaButton.click({ force: true });
    console.info("ticketlog.eva:launcher-clicked");
    if (await this.getEvaFrame(5_000)) return;

    // Some legacy pages bind the chat opening action to a double click.
    await evaButton.dblclick({ force: true }).catch(() => undefined);
    if (!(await this.getEvaFrame(8_000))) {
      throw new ManualInterventionError("EVA_PANEL_NOT_FOUND");
    }
  }

  async releaseFuelRestriction(plate: string): Promise<void> {
    const frame = await this.openReleaseFuelRestrictionFlow();
    const textbox = await this.waitForVisible(
      [
        frame.getByRole("textbox").last(),
        frame.locator("textarea:visible").last(),
        frame.locator("input:visible").last(),
      ],
      15_000,
    );

    await textbox.fill(normalizePlate(plate));
    console.info("ticketlog.eva:plate-filled");

    await this.waitForVisible(
      [
        frame.getByRole("button", { name: /enviar|confirmar|send|confirm/i }),
        frame.locator("button:visible").last(),
      ],
      10_000,
    ).then((locator) => locator.click());

    const confirmation = await this.waitForEvaConfirmation(frame);
    if (!confirmation) {
      throw new ManualInterventionError("EVA_RELEASE_CONFIRMATION_NOT_FOUND");
    }
    console.info("ticketlog.eva:release-confirmed");
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

    await this.clickEvaOption(frame, ticketLogUi.eva.transactions);
    await this.clickEvaOption(frame, ticketLogUi.eva.releaseFuelRestriction);
    return frame;
  }

  private async clickEvaOption(frame: Frame, name: RegExp): Promise<void> {
    const option = await this.waitForVisible([
      frame.getByRole("button", { name }),
      frame.getByText(name).first(),
    ]);

    await option.click({ force: true });
    console.info({ option: name.source }, "ticketlog.eva:option-clicked");
    await this.page.waitForTimeout(200);
  }

  private async requireEvaFrame(): Promise<Frame> {
    const frame = await this.getEvaFrame();
    if (!frame) throw new ManualInterventionError("EVA_PANEL_NOT_FOUND");
    return frame;
  }

  private async getEvaFrame(timeoutMs = 10_000): Promise<Frame | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of this.page.frames()) {
        const body = await frame.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
        if (isEvaFrameCandidate(frame.url(), body)) return frame;
      }

      await this.page.waitForTimeout(250);
    }

    return null;
  }

  private async waitForEvaConfirmation(frame: Frame): Promise<string | null> {
    const deadline = Date.now() + 45_000;

    while (Date.now() < deadline) {
      const body = await frame.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
      if (isEvaReleaseConfirmation(body)) return body.slice(0, 500);
      await this.page.waitForTimeout(500);
    }

    return null;
  }

  private async findEvaLauncher(timeoutMs: number): Promise<Locator | null> {
    const deadline = Date.now() + timeoutMs;
    do {
      for (const scope of [this.page, ...this.page.frames()]) {
        const candidates = [
          ...ticketLogUi.eva.launcherSelectors.map((selector) =>
            scope.locator(selector).first(),
          ),
          scope
            .getByRole("button", { name: ticketLogUi.eva.launcherRole })
            .first(),
          ...ticketLogUi.eva.launcherImageSelectors.map((selector) =>
            scope.locator(selector).first(),
          ),
        ];

        for (const candidate of candidates) {
          if (await candidate.isVisible().catch(() => false)) return candidate;
        }
      }

      if (Date.now() < deadline) await this.page.waitForTimeout(250);
    } while (Date.now() < deadline);

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
