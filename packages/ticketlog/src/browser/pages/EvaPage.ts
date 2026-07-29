import { expect, type Frame, type Locator, type Page } from "@playwright/test";
import { ManualInterventionError, normalizePlate } from "@ticketlog/domain";
import {
  isEvaFrameCandidate,
  isEvaReleaseConfirmation,
  ticketLogUi,
} from "../uiMap.js";

type EvaScope = Page | Frame;

export class EvaPage {
  constructor(private readonly page: Page) {}

  async isAvailable(timeoutMs = 2_500): Promise<boolean> {
    if (await this.getEvaSurface(250)) return true;
    return (await this.findEvaLauncher(timeoutMs)) !== null;
  }

  async open(): Promise<void> {
    const existingSurface = await this.getEvaSurface(500);
    if (existingSurface) {
      if (!(await this.isRejectedSurface(existingSurface))) return;

      console.warn("ticketlog.eva:rejected-url-detected");
      if (!(await this.closePanelIfOpen())) {
        throw new ManualInterventionError("EVA_URL_REJECTED");
      }
      console.info("ticketlog.eva:rejected-panel-closed");
    }
    await this.dismissBlockingEvaPrompts();

    const evaButton = await this.findEvaLauncher(8_000);
    if (!evaButton) {
      throw new ManualInterventionError("EVA_BUTTON_NOT_FOUND");
    }

    await this.clickEvaLauncher(evaButton);
    const openedSurface = await this.getEvaSurface(8_000);
    if (openedSurface) {
      await this.assertSurfaceAccepted(openedSurface);
      return;
    }

    await this.dismissBlockingEvaPrompts();
    await this.clickEvaLauncher(evaButton, true);
    const retriedSurface = await this.getEvaSurface(12_000);
    if (!retriedSurface) {
      await this.logEvaOpenDiagnostics();
      throw new ManualInterventionError("EVA_PANEL_NOT_FOUND");
    }
    await this.assertSurfaceAccepted(retriedSurface);
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

  async closePanelIfOpen(timeoutMs = 1_500): Promise<boolean> {
    const initialSurface = await this.getEvaSurface(timeoutMs);
    if (!initialSurface) return false;

    const finishConversation = await this.findVisibleOrNull(
      [
        initialSurface.getByRole("button", { name: /sair e avaliar|exit and rate/i }).first(),
        initialSurface.getByText(/sair e avaliar|exit and rate/i).first(),
      ],
      500,
    );
    if (finishConversation) {
      await finishConversation.click({ force: true }).catch(() => undefined);
      await this.page.waitForTimeout(400);
      if (!(await this.getEvaSurface(500))) {
        console.info("ticketlog.eva:conversation-finished-and-panel-closed");
        return true;
      }
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const closed = await this.closeOneEvaPanel();
      if (closed) {
        await this.page.waitForTimeout(500);
        if (!(await this.getEvaSurface(750))) {
          console.info("ticketlog.eva:panel-closed");
          return true;
        }
      }
    }

    await this.page.keyboard.press("Escape").catch(() => undefined);
    await this.page.waitForTimeout(500);
    const panelClosed = !(await this.getEvaSurface(750));
    if (panelClosed) console.info("ticketlog.eva:panel-closed-with-escape");
    else console.warn("ticketlog.eva:panel-still-open");
    return panelClosed;
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
    let frame = await this.requireEvaSurface();

    const startAnotherRelease = await this.findVisibleOrNull(
      [
        frame.getByRole("button", { name: /incluir nova libera..o de restri..o|new restriction release/i }).first(),
        frame.getByText(/incluir nova libera..o de restri..o|new restriction release/i).first(),
      ],
      750,
    );
    if (startAnotherRelease) {
      await startAnotherRelease.click({ force: true });
      console.info("ticketlog.eva:new-release-option-clicked");
      await this.page.waitForTimeout(250);
      return frame;
    }

    const transactionsAvailable = await this.findVisibleOrNull(
      [
        frame.getByRole("button", { name: ticketLogUi.eva.transactions }).first(),
        frame.getByText(ticketLogUi.eva.transactions).first(),
      ],
      500,
    );
    if (!transactionsAvailable) {
      const backToMenu = await this.findVisibleOrNull(
        [
          frame.getByRole("button", { name: /voltar ao menu|back to menu/i }).first(),
          frame.getByText(/voltar ao menu|back to menu/i).first(),
        ],
        750,
      );
      if (backToMenu) {
        await backToMenu.click({ force: true });
        console.info("ticketlog.eva:back-to-menu-clicked");
        await this.page.waitForTimeout(300);
        frame = await this.requireEvaSurface();
      } else {
        await this.closePanelIfOpen();
        await this.open();
        frame = await this.requireEvaSurface();
        console.info("ticketlog.eva:conversation-reset-by-reopen");
      }
    }

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

  private async requireEvaSurface(): Promise<Frame> {
    const frame = await this.getEvaSurface();
    if (!frame) throw new ManualInterventionError("EVA_PANEL_NOT_FOUND");
    await this.assertSurfaceAccepted(frame);
    return frame;
  }

  private async getEvaSurface(timeoutMs = 10_000): Promise<Frame | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let bestCandidate: { frame: Frame; score: number } | null = null;
      for (const frame of this.page.frames()) {
        const body = await frame.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
        if (!isEvaFrameCandidate(frame.url(), body)) continue;

        const visibleControls = await frame
          .locator("button:visible, [role='button']:visible, textarea:visible, input:visible")
          .count()
          .catch(() => 0);
        const hasOperationalText =
          /transa..es|transactions|liberar abastecimento|incluir nova libera..o|voltar ao menu|sair e avaliar|digite aqui/i.test(
            body,
          );
        const rejectedPage = ticketLogUi.eva.rejectedPage.test(body);
        const score =
          (ticketLogUi.eva.rootText.test(body) ? 20 : 0) +
          (hasOperationalText ? 15 : 0) +
          (rejectedPage ? 30 : 0) +
          Math.min(visibleControls, 10) +
          (frame.url().includes(ticketLogUi.eva.frameHost) ? 3 : 0);

        if (score >= 10 && (!bestCandidate || score > bestCandidate.score)) {
          bestCandidate = { frame, score };
        }
      }
      if (bestCandidate) return bestCandidate.frame;

      await this.page.waitForTimeout(250);
    }

    return null;
  }

  private async isRejectedSurface(frame: Frame): Promise<boolean> {
    const body = await frame.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
    return ticketLogUi.eva.rejectedPage.test(body);
  }

  private async assertSurfaceAccepted(frame: Frame): Promise<void> {
    if (!(await this.isRejectedSurface(frame))) return;

    console.warn("ticketlog.eva:rejected-url-detected");
    await this.closePanelIfOpen().catch(() => false);
    throw new ManualInterventionError("EVA_URL_REJECTED");
  }

  private async waitForEvaConfirmation(frame: Frame): Promise<string | null> {
    const deadline = Date.now() + 45_000;

    while (Date.now() < deadline) {
      const body = await frame.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
      if (ticketLogUi.eva.rejectedPage.test(body)) {
        console.warn("ticketlog.eva:rejected-url-detected-during-confirmation");
        await this.closePanelIfOpen().catch(() => false);
        throw new ManualInterventionError("EVA_URL_REJECTED");
      }
      if (isEvaReleaseConfirmation(body)) return body.slice(0, 500);
      await this.page.waitForTimeout(500);
    }

    return null;
  }

  private async findEvaLauncher(timeoutMs: number): Promise<Locator | null> {
    const deadline = Date.now() + timeoutMs;
    do {
      for (const scope of [this.page, ...this.page.frames()]) {
        if (await this.scopeHasEvaPanel(scope)) {
          continue;
        }

        const candidates = [
          ...ticketLogUi.eva.launcherSelectors.map((selector) =>
            scope.locator(selector).first(),
          ),
          scope
            .getByRole("button", { name: ticketLogUi.eva.launcherRole })
            .first(),
          ...ticketLogUi.eva.launcherImageSelectors.flatMap((selector) => [
            scope
              .locator(selector)
              .first()
              .locator(
                "xpath=ancestor-or-self::*[self::button or self::a or @role='button' or contains(@id,'eva') or contains(@id,'Eva') or contains(@class,'eva') or contains(@class,'Eva')][1]",
              ),
            scope.locator(selector).first(),
          ]),
        ];

        for (const candidate of candidates) {
          if (await candidate.isVisible().catch(() => false)) return candidate;
        }
      }

      if (Date.now() < deadline) await this.page.waitForTimeout(250);
    } while (Date.now() < deadline);

    return null;
  }

  private async scopeHasEvaPanel(scope: EvaScope): Promise<boolean> {
    const body = await scope.locator("body").innerText({ timeout: 750 }).catch(() => "");
    return isEvaFrameCandidate(scope === this.page ? this.page.url() : (scope as Frame).url(), body);
  }

  private async clickEvaLauncher(locator: Locator, doubleClick = false): Promise<void> {
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    if (doubleClick) {
      await locator.dblclick({ force: true }).catch(async () => {
        const box = await locator.boundingBox();
        if (!box) return;
        await this.page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
      });
      console.info("ticketlog.eva:launcher-double-clicked");
      return;
    }

    await locator.click({ force: true }).catch(async () => {
      const box = await locator.boundingBox();
      if (!box) throw new ManualInterventionError("EVA_BUTTON_NOT_CLICKABLE");
      await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    });
    console.info("ticketlog.eva:launcher-clicked");
  }

  private async dismissBlockingEvaPrompts(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const closed = await this.closeOneBlockingEvaPrompt();
      if (!closed) return;
      await this.page.waitForTimeout(250);
    }
  }

  private async closeOneBlockingEvaPrompt(): Promise<boolean> {
    for (const scope of [this.page, ...this.page.frames()]) {
      for (const selector of ticketLogUi.eva.blockingPromptCloseSelectors) {
        const closeControl = scope.locator(selector).first();
        if (await closeControl.isVisible().catch(() => false)) {
          await closeControl.click({ force: true }).catch(() => undefined);
          console.info({ selector }, "ticketlog.eva:blocking-prompt-closed");
          return true;
        }
      }

      const result = await scope
        .locator("body")
        .evaluate((body, promptPatternSource) => {
          const normalize = (value: string) =>
            value
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim();
          const promptPattern = new RegExp(promptPatternSource, "i");
          const elements = Array.from(
            body.querySelectorAll<HTMLElement>("div, section, article, aside, [role='dialog']"),
          );
          const popups = elements
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const text = normalize(node.innerText ?? node.textContent ?? "");
              return { node, rect, text, area: rect.width * rect.height };
            })
            .filter(
              ({ rect, text }) =>
                promptPattern.test(text) &&
                rect.width >= 220 &&
                rect.height >= 120 &&
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.top < window.innerHeight &&
                rect.left < window.innerWidth,
            )
            .sort((left, right) => left.area - right.area);
          if (popups.length === 0) return false;

          for (const { node: popup, rect: popupRect } of popups) {
            const controls = Array.from(
              popup.querySelectorAll<HTMLElement>("button, [role='button'], a, div, span, svg"),
            )
              .map((control) => {
                const rect = control.getBoundingClientRect();
                const text = normalize(control.innerText ?? control.textContent ?? "");
                const metadata = normalize(
                  `${control.getAttribute("aria-label") ?? ""} ${control.getAttribute("title") ?? ""} ${control.className?.toString() ?? ""}`,
                );
                const style = window.getComputedStyle(control);
                const explicitClose =
                  /fechar|close|dismiss/.test(metadata) || /^(?:x|×)$/.test(text);
                const topRightControl =
                  rect.width >= 10 &&
                  rect.width <= 80 &&
                  rect.height >= 10 &&
                  rect.height <= 80 &&
                  rect.left >= popupRect.right - 110 &&
                  rect.right <= popupRect.right + 30 &&
                  rect.top >= popupRect.top - 35 &&
                  rect.top <= popupRect.top + 110 &&
                  !/liberar restricao|pegue a sua fatura|mais informacoes/.test(text) &&
                  (control.tagName === "BUTTON" ||
                    control.getAttribute("role") === "button" ||
                    style.cursor === "pointer" ||
                    Boolean(control.querySelector("svg")));
                return { control, rect, explicitClose, topRightControl };
              })
              .filter(({ explicitClose, topRightControl }) => explicitClose || topRightControl)
              .sort((left, right) => {
                if (left.explicitClose !== right.explicitClose) return left.explicitClose ? -1 : 1;
                return right.rect.right - left.rect.right || left.rect.top - right.rect.top;
              });
            const target = controls[0]?.control;
            if (!target) continue;
            target.click();
            return true;
          }

          return false;
        }, ticketLogUi.eva.blockingPromptText.source)
        .catch(() => false);
      if (result) {
        console.info("ticketlog.eva:blocking-prompt-closed");
        return true;
      }
    }

    return false;
  }

  private async closeOneEvaPanel(): Promise<boolean> {
    for (const scope of [this.page, ...this.page.frames()]) {
      const namedClose = await this.findVisible([
        scope.getByRole("button", { name: /minimi[sz]ar|fechar|close|minimi[sz]e/i }).first(),
        scope.locator("button[aria-label*='minim' i], button[title*='minim' i]").first(),
        scope.locator("button[aria-label*='fechar' i], button[title*='fechar' i]").first(),
        scope.locator("button[aria-label*='close' i], button[title*='close' i]").first(),
      ]).catch(() => null);

      if (namedClose) {
        await namedClose.click({ force: true }).catch(() => undefined);
        console.info("ticketlog.eva:panel-close-control-clicked");
        return true;
      }

      const result = await scope
        .locator("body")
        .evaluate((body, rootPatternSource) => {
          const normalize = (value: string) =>
            value
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim();
          const rootPattern = new RegExp(rootPatternSource, "i");
          const rejectText =
            /incluir nova liberacao|voltar ao menu|sair e avaliar|liberar abastecimento|transacoes|enviar|confirmar|digite aqui/.source;
          const rejectPattern = new RegExp(rejectText, "i");
          const elements = Array.from(
            body.querySelectorAll<HTMLElement>("div, section, article, aside, [role='dialog'], body"),
          );
          const panels = elements
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const text = normalize(node.innerText ?? node.textContent ?? "");
              return { node, rect, text, area: rect.width * rect.height };
            })
            .filter(
              ({ rect, text }) =>
                rootPattern.test(text) &&
                rect.width >= 240 &&
                rect.height >= 220 &&
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.top < window.innerHeight &&
                rect.left < window.innerWidth,
            )
            .sort((left, right) => left.area - right.area);

          for (const { node: panel, rect: panelRect } of panels) {
            const controls = Array.from(
              panel.querySelectorAll<HTMLElement>("button, [role='button'], a, div, span, svg"),
            )
              .map((control) => {
                const rect = control.getBoundingClientRect();
                const text = normalize(control.innerText ?? control.textContent ?? "");
                const metadata = normalize(
                  `${control.getAttribute("aria-label") ?? ""} ${control.getAttribute("title") ?? ""} ${control.className?.toString() ?? ""} ${control.id ?? ""}`,
                );
                const style = window.getComputedStyle(control);
                const explicitClose =
                  /minimi[sz]ar|fechar|close|minimi[sz]e/.test(metadata) || /^(?:-|–|—|x|×)$/.test(text);
                const topRightControl =
                  rect.width >= 8 &&
                  rect.width <= 90 &&
                  rect.height >= 8 &&
                  rect.height <= 90 &&
                  rect.left >= panelRect.right - 130 &&
                  rect.right <= panelRect.right + 40 &&
                  rect.top >= panelRect.top - 40 &&
                  rect.top <= panelRect.top + 120 &&
                  !rejectPattern.test(text) &&
                  (control.tagName === "BUTTON" ||
                    control.getAttribute("role") === "button" ||
                    style.cursor === "pointer" ||
                    Boolean(control.querySelector("svg")));
                return { control, rect, explicitClose, topRightControl };
              })
              .filter(({ explicitClose, topRightControl }) => explicitClose || topRightControl)
              .sort((left, right) => {
                if (left.explicitClose !== right.explicitClose) return left.explicitClose ? -1 : 1;
                return right.rect.right - left.rect.right || left.rect.top - right.rect.top;
              });

            const target = controls[0]?.control;
            if (!target) continue;
            target.click();
            return true;
          }

          return false;
        }, `(?:${ticketLogUi.eva.rootText.source})|(?:${ticketLogUi.eva.releaseConfirmation.source})|(?:${ticketLogUi.eva.rejectedPage.source})`)
        .catch(() => false);
      if (result) {
        console.info("ticketlog.eva:panel-close-control-clicked");
        return true;
      }
    }

    return false;
  }

  private async logEvaOpenDiagnostics(): Promise<void> {
    const frames = await Promise.all(
      this.page.frames().map(async (frame) => ({
        url: frame.url().slice(0, 180),
        text: (await frame.locator("body").innerText({ timeout: 500 }).catch(() => "")).slice(0, 180),
      })),
    );
    const launcherCount = await this.countVisibleLaunchers().catch(() => -1);
    console.warn({ url: this.page.url(), launcherCount, frames }, "ticketlog.eva:open-diagnostics");
  }

  private async countVisibleLaunchers(): Promise<number> {
    let count = 0;
    for (const scope of [this.page, ...this.page.frames()]) {
      for (const selector of [
        ...ticketLogUi.eva.launcherSelectors,
        ...ticketLogUi.eva.launcherImageSelectors,
      ]) {
        count += await scope.locator(selector).evaluateAll((nodes) =>
          nodes.filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }).length,
        ).catch(() => 0);
      }
    }
    return count;
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

  private async findVisibleOrNull(candidates: Locator[], timeoutMs: number): Promise<Locator | null> {
    const deadline = Date.now() + timeoutMs;
    do {
      for (const candidate of candidates) {
        const locator = candidate.first();
        if (await locator.isVisible().catch(() => false)) return locator;
      }
      if (Date.now() < deadline) await this.page.waitForTimeout(100);
    } while (Date.now() < deadline);

    return null;
  }

  private async findVisible(candidates: Locator[]): Promise<Locator> {
    for (const candidate of candidates) {
      const locator = candidate.first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }

    throw new ManualInterventionError("VISIBLE_LOCATOR_NOT_FOUND");
  }
}
