import { expect, type Frame, type Locator, type Page } from "@playwright/test";
import { formatCurrencyInput, IndeterminateResultError, ManualInterventionError, normalizePlate } from "@ticketlog/domain";

export class FleetVehiclePage {
  constructor(private readonly page: Page) {}

  async gotoVehicleList(): Promise<void> {
    const url = process.env.TICKETLOG_VEHICLE_LIST_URL;
    if (!url) throw new Error("TICKETLOG_VEHICLE_LIST_URL is required");
    await this.dismissBlockingOverlays();

    if (await this.waitForVehicleListReady(1_500)) {
      return;
    }

    const navigatedThroughUi = await this.clickVehicleListEntrypoint(5_000)
      .then(() => true)
      .catch(() => false);
    if (navigatedThroughUi && (await this.waitForVehicleListReady(15_000))) {
      return;
    }

    if (!/\/register\/fleet\/vehicle\/list(?:$|[?#])/i.test(this.page.url())) {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await this.page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await this.dismissBlockingOverlays();
    }

    if (!(await this.waitForVehicleListReady())) {
      throw new ManualInterventionError("VEHICLE_LIST_NOT_LOADED");
    }
  }

  async searchPlate(plate: string): Promise<{ count: number; foundPlate?: string }> {
    await this.dismissBlockingOverlays();
    const normalized = normalizePlate(plate);
    const plateSearch = await this.findVisible(
      [
        this.page.getByLabel(/placa|plate|identificador|identifier/i),
        this.page.getByPlaceholder(/placa|plate|identificador|identifier|pesquise|busque|search|buscar na tabela/i),
        this.page.locator("input:visible").first(),
        this.page.getByRole("textbox").filter({ hasText: /placa|plate|identificador|identifier/i }),
        this.page.getByRole("textbox").first(),
      ],
      "PLATE_SEARCH_INPUT_NOT_FOUND",
    );

    await plateSearch.fill(normalized);
    const searchButton = this.page.getByRole("button", { name: /pesquisar|buscar|filtrar|search|filter/i }).first();
    if (await searchButton.isVisible().catch(() => false)) {
      await searchButton.click();
    } else {
      await plateSearch.press("Enter");
    }

    await this.waitForPlateSearchResult(normalized);

    const rows = this.page.getByRole("row").filter({ hasText: normalized });
    const count = await rows.count();
    return { count, foundPlate: count === 1 ? normalized : undefined };
  }

  async openPlate(plate: string): Promise<void> {
    await this.dismissBlockingOverlays();
    const normalized = normalizePlate(plate);
    const plateLink = await this.findVisible(
      [
        this.page.getByRole("link", { name: new RegExp(normalized, "i") }),
        this.page.getByText(normalized, { exact: false }).first(),
      ],
      "PLATE_LINK_NOT_FOUND",
    );
    await plateLink.click();
    await expect(this.page.getByText(normalized).first()).toBeVisible();
    await expect(this.page.getByText(/detalhes do ve.culo|vehicle details/i).first()).toBeVisible({ timeout: 30_000 });
  }

  async isBlocked(): Promise<boolean> {
    const activeBadge = this.page.getByText(/^ativo$/i).first();
    if (await activeBadge.isVisible().catch(() => false)) return false;

    const blockedBadge = this.page.getByText(/^bloquead[oa](?:\s|$)/i).first();
    return blockedBadge.isVisible().catch(() => false);
  }

  async unblockVehicle(): Promise<void> {
    await this.dismissBlockingOverlays();
    await this.page.getByRole("button", { name: /desbloquear|unblock/i }).click();
    await this.page.getByRole("button", { name: /confirmar|sim|confirm|yes/i }).click();
    await expect(this.page.getByText(/desbloquead[oa].*sucesso|unblocked.*success|ativo|active/i)).toBeVisible();
  }

  async readCurrentLimit(): Promise<number | null> {
    const label = this.page.getByText(/limite atual|limite total|current limit|total limit/i).first();
    if (!(await label.isVisible().catch(() => false))) return null;
    const text = await label.locator("..").innerText();
    const match = text.replace(/\./g, "").replace(",", ".").match(/(\d+(?:\.\d{2})?)/);
    return match ? Number(match[1]) : null;
  }

  async addTemporaryLimit(input: { plate: string; amount: number; reason: string }): Promise<string> {
    const formFrame = await this.openChangeLimitForm();
    await this.fillTemporaryLimitForm(formFrame, input);
    await this.dismissBlockingOverlays();

    await formFrame.locator("input#btnAlterar, input[type='button'][value='Alterar']").first().click();
    await this.confirmLimitSubmission();

    const confirmation = await this.waitForLimitChangeConfirmation();
    if (!confirmation) {
      throw new IndeterminateResultError("CHANGE_LIMIT_CONFIRMATION_NOT_FOUND");
    }

    return confirmation;
  }

  async prepareTemporaryLimitDryRun(input: { plate: string; amount: number; reason: string }): Promise<string> {
    const formFrame = await this.openChangeLimitForm();
    await this.fillTemporaryLimitForm(formFrame, input);
    await expect(formFrame.locator("input#btnAlterar, input[type='button'][value='Alterar']").first()).toBeVisible();
    return "Formulario de limite preenchido em dry-run; botao final Alterar nao foi acionado";
  }

  private async openChangeLimitForm(): Promise<Page | Frame> {
    await this.dismissBlockingOverlays();
    const openedFrame = await this.waitForChangeLimitFrame(1_000);
    if (openedFrame) {
      return openedFrame;
    }

    await this.clickChangeLimitEntrypoint();
    await this.page.waitForLoadState("domcontentloaded").catch(() => undefined);
    const formFrame = await this.waitForChangeLimitFrame();
    if (!formFrame) {
      throw new ManualInterventionError("CHANGE_LIMIT_FORM_NOT_LOADED");
    }
    return formFrame;
  }

  private async clickChangeLimitEntrypoint(): Promise<void> {
    await this.dismissBlockingOverlays();
    const attempts: string[] = [];
    const direct = await this.findVisible(
      [
        this.page.getByRole("button", { name: /altera..o de limite|alterar limite|change limit/i }),
        this.page.getByRole("link", { name: /altera..o de limite|alterar limite|change limit/i }),
      ],
      "CHANGE_LIMIT_DIRECT_ENTRYPOINT_NOT_FOUND",
    ).catch(() => null);

    if (direct) {
      attempts.push("direct-role");
      if (await this.clickAndConfirmChangeLimit(direct)) return;
    }

    const text = this.page.getByText(/^\s*(?:alterar\s+limite|change\s+limit)\s*$/i).first();
    if (!(await text.isVisible().catch(() => false))) {
      throw new ManualInterventionError("CHANGE_LIMIT_ENTRYPOINT_NOT_FOUND");
    }

    await text.scrollIntoViewIfNeeded();
    const clickableCard = text.locator(
      "xpath=ancestor::*[self::button or self::a or @role='button' or contains(@class,'card') or contains(@class,'Card')][1]",
    );

    attempts.push("ancestor-card");
    if (await this.clickAndConfirmChangeLimit(clickableCard)) return;
    attempts.push("text");
    if (await this.clickAndConfirmChangeLimit(text)) return;
    attempts.push("visual-centers");
    if (await this.clickVisualCardCenter(text)) return;

    attempts.push(`url:${this.page.url()}`);
    throw new ManualInterventionError(`CHANGE_LIMIT_CLICK_DID_NOT_OPEN_FORM:${attempts.join("|")}`);
  }

  private async checkOptionByText(scope: Page | Frame, name: RegExp): Promise<void> {
    const label = scope.getByText(name).first();
    if (!(await label.isVisible().catch(() => false))) {
      throw new ManualInterventionError("OPTION_NOT_FOUND");
    }

    const input = label.locator("xpath=preceding::input[@type='radio' or @type='checkbox'][1]");
    if (await input.isVisible().catch(() => false)) {
      await input.check();
      return;
    }

    await label.click();
  }

  private async fillTemporaryLimitForm(
    formFrame: Page | Frame,
    input: { plate: string; amount: number; reason: string },
  ): Promise<void> {
    await this.dismissBlockingOverlays();
    const addToCurrentLimit = formFrame.locator("input[type='radio'][name='tipo'][value='AR']").first();
    if (await addToCurrentLimit.isVisible().catch(() => false)) {
      await addToCurrentLimit.check({ force: true });
    } else {
      await this.checkOptionByText(formFrame, /adicionar o valor ao limite atual|add.*current limit/i);
    }

    const value = formatCurrencyInput(input.amount);
    const valueField = formFrame.locator("input#valor, input[name='valor']").first();
    await expect(valueField).toBeVisible();
    await valueField.fill(value);
    await expect(valueField).toHaveValue(value);

    const currentPeriod = formFrame.locator("input[type='radio'][name='fl_tipo_operacao'][value='SP']").first();
    if (await currentPeriod.isVisible().catch(() => false)) {
      await currentPeriod.check({ force: true });
    } else {
      await this.checkOptionByText(formFrame, /somente para o per[ií]odo|only for the period/i);
    }

    const reasonField = formFrame.locator("input#ds_justifica, input[name='ds_justifica']").first();
    await expect(reasonField).toBeVisible();
    await reasonField.fill(input.reason);
    await expect(reasonField).toHaveValue(input.reason);

    const normalizedPlate = normalizePlate(input.plate);
    const row = formFrame.locator("tr").filter({ hasText: normalizedPlate });
    const rowCount = await row.count();
    if (rowCount !== 1) {
      throw new ManualInterventionError(
        rowCount === 0 ? "PLATE_ROW_NOT_FOUND_ON_LIMIT_FORM" : "MULTIPLE_PLATE_ROWS_ON_LIMIT_FORM",
      );
    }

    let plateCheckbox = row.first().locator("input[type='checkbox'][name='chklimite']").first();
    await expect(plateCheckbox).toBeVisible();
    if (!(await plateCheckbox.isChecked())) {
      await plateCheckbox.click({ force: true }).catch(() => undefined);
      await this.page.waitForTimeout(500);
      plateCheckbox = formFrame
        .locator("tr")
        .filter({ hasText: normalizedPlate })
        .first()
        .locator("input[type='checkbox'][name='chklimite']")
        .first();
    }

    if (!(await plateCheckbox.isChecked())) {
      const selectText = row.first().getByText(/selecionar|select/i).first();
      if (await selectText.isVisible().catch(() => false)) {
        await selectText.click({ force: true }).catch(() => undefined);
        await this.page.waitForTimeout(500);
      }
      plateCheckbox = formFrame
        .locator("tr")
        .filter({ hasText: normalizedPlate })
        .first()
        .locator("input[type='checkbox'][name='chklimite']")
        .first();
    }

    if (!(await plateCheckbox.isChecked())) {
      await plateCheckbox.evaluate((element) => {
        const checkbox = element as HTMLInputElement;
        checkbox.checked = true;
        checkbox.setAttribute("checked", "checked");
        checkbox.dispatchEvent(new Event("input", { bubbles: true }));
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    await expect(plateCheckbox).toBeChecked();
  }

  private async waitForLimitChangeConfirmation(): Promise<string | null> {
    const deadline = Date.now() + 60_000;
    const successPattern =
      /alterad[oa].*sucesso|limite.*atualizad[oa]|opera..o.*sucesso|altera..o.*realizad[ao]|solicita..o.*realizad[ao]|processad[ao].*sucesso|sucesso ao alterar|limit.*(?:changed|updated).*success|operation.*success|successfully.*(?:changed|updated)/i;
    const validationErrorPattern =
      /preencha|campo obrigat.rio|selecione ao menos|valor inv.lido|n.o foi poss.vel|erro ao alterar/i;

    while (Date.now() < deadline) {
      await this.page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await this.dismissBlockingOverlays();

      for (const scope of [this.page, ...this.page.frames()]) {
        const bodyText = await scope.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
        const match = bodyText.match(successPattern);
        if (match) return bodyText.slice(0, 500);
        if (validationErrorPattern.test(bodyText) && /limite|alterar/i.test(bodyText)) {
          throw new ManualInterventionError("CHANGE_LIMIT_VALIDATION_OR_PLATFORM_ERROR");
        }
      }

      const formStillOpen = await this.waitForChangeLimitFrame(1_000);
      if (!formStillOpen) {
        const detailsVisible = await this.page.getByText(/detalhes do ve.culo|vehicle details/i).first().isVisible().catch(() => false);
        const limitVisible = await this.page.getByText(/limite atual|limite total|current limit|total limit/i).first().isVisible().catch(() => false);
        const changeCardVisible = await this.page.getByText(/^\s*(?:alterar\s+limite|change\s+limit)\s*$/i).first().isVisible().catch(() => false);

        if (detailsVisible && (limitVisible || changeCardVisible)) {
          return "ALTERACAO_SUBMETIDA_SEM_BANNER_EXPLICITO";
        }
      }

      await this.page.waitForTimeout(1_000);
    }

    return null;
  }

  private async findVisible(
    candidates: Locator[],
    errorCode = "VISIBLE_LOCATOR_NOT_FOUND",
    timeoutMs = 0,
  ): Promise<Locator> {
    const deadline = Date.now() + timeoutMs;
    do {
      for (const candidate of candidates) {
        const locator = candidate.first();
        if (await locator.isVisible().catch(() => false)) {
          return locator;
        }
      }

      if (Date.now() < deadline) {
        await this.page.waitForTimeout(500);
      }
    } while (Date.now() < deadline);

    throw new ManualInterventionError(errorCode);
  }

  private async waitForPlateSearchResult(plate: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const rows = this.page.getByRole("row").filter({ hasText: plate });
      if ((await rows.count()) > 0) return;

      const emptyState = this.page.getByText(/nenhum registro|nenhum resultado|n.o encontrado|sem resultado|no records|no results|not found/i).first();
      if (await emptyState.isVisible().catch(() => false)) return;

      await this.page.waitForTimeout(500);
    }
  }

  private async waitForVehicleListReady(timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.dismissBlockingOverlays();
      const currentUrl = this.page.url();
      if (/edenred\.io\/web\/session\/step\//i.test(currentUrl)) {
        throw new ManualInterventionError("UNEXPECTED_CAPTCHA_OR_MFA");
      }

      if (await this.page.getByLabel(/usu.rio|e-mail|email|login/i).first().isVisible().catch(() => false)) {
        throw new ManualInterventionError("TICKETLOG_SESSION_NOT_AUTHENTICATED");
      }

      if (await this.page.getByText(/captcha|mfa|autenticador|token|c.digo/i).first().isVisible().catch(() => false)) {
        throw new ManualInterventionError("UNEXPECTED_CAPTCHA_OR_MFA");
      }

      const bodyText = await this.page.locator("body").innerText().catch(() => "");
      if (/c.digo de verifica..o|receber c.digo por e-mail|solicitar novo c.digo/i.test(bodyText)) {
        throw new ManualInterventionError("UNEXPECTED_CAPTCHA_OR_MFA");
      }

      const signals = [
        this.page.getByPlaceholder(/buscar na tabela|search.*table/i).first(),
        this.page.getByText(/meus ve.culos\s*\/\s*equipamentos|my vehicles\s*\/\s*equipment/i).first(),
        this.page.getByText(/placa\s*\/\s*identificador|plate\s*\/\s*identifier/i).first(),
      ];

      for (const signal of signals) {
        if (await signal.isVisible().catch(() => false)) return true;
      }

      await this.page.waitForTimeout(500);
    }

    return false;
  }

  private async clickVehicleListEntrypoint(timeoutMs = 30_000): Promise<void> {
    const entrypoint = await this.findVisible(
      [
        this.page.getByText(/^\s*(?:ve.culo|vehicle)\s*$/i).first(),
        this.page.getByText(/^\s*(?:equipamento|equipment)\s*$/i).first(),
        this.page.getByRole("link", { name: /ve.culo|vehicle|equipamento|equipment/i }).first(),
        this.page.getByRole("button", { name: /ve.culo|vehicle|equipamento|equipment/i }).first(),
      ],
      "VEHICLE_LIST_ENTRYPOINT_NOT_FOUND",
      timeoutMs,
    );

    await entrypoint.scrollIntoViewIfNeeded().catch(() => undefined);
    await entrypoint.click().catch(async () => {
      const box = await entrypoint.boundingBox();
      if (!box) throw new ManualInterventionError("VEHICLE_LIST_ENTRYPOINT_NOT_CLICKABLE");
      await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    });
    await this.page.waitForLoadState("domcontentloaded").catch(() => undefined);
  }

  private async clickAndConfirmChangeLimit(locator: Locator): Promise<boolean> {
    if (!(await locator.isVisible().catch(() => false))) return false;

    await this.dismissBlockingOverlays();
    await locator.click().catch(() => undefined);
    await this.page.waitForLoadState("domcontentloaded").catch(() => undefined);

    return this.waitForChangeLimitForm();
  }

  private async clickVisualCardCenter(text: Locator): Promise<boolean> {
    const centers = await text.evaluate((element) => {
      const candidates: Array<{ x: number; y: number }> = [];
      const textRect = element.getBoundingClientRect();
      candidates.push({
        x: textRect.left + textRect.width / 2,
        y: textRect.top + textRect.height / 2,
      });
      candidates.push({
        x: textRect.left + textRect.width / 2,
        y: textRect.top - 70,
      });
      let current: HTMLElement | null = element instanceof HTMLElement ? element : element.parentElement;

      for (let index = 0; current && index < 8; index += 1) {
        const rect = current.getBoundingClientRect();
        if (rect.width >= 80 && rect.height >= 60) {
          candidates.push({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
        }
        current = current.parentElement;
      }

      return candidates;
    });

    for (const center of centers) {
      await this.dismissBlockingOverlays();
      await this.page.mouse.click(center.x, center.y);
      await this.page.waitForLoadState("domcontentloaded").catch(() => undefined);
      if (await this.waitForChangeLimitForm()) return true;
    }

    return false;
  }

  private async waitForChangeLimitForm(timeoutMs = 45_000): Promise<boolean> {
    return (await this.waitForChangeLimitFrame(timeoutMs)) !== null;
  }

  private async waitForChangeLimitFrame(timeoutMs = 45_000): Promise<Page | Frame | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await this.dismissBlockingOverlays();

      for (const scope of [this.page, ...this.page.frames()]) {
        const bodyText = await scope.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
        const stableFormFieldsVisible =
          (await scope.locator("input#valor, input[name='valor']").first().isVisible().catch(() => false)) &&
          (await scope
            .locator("input[type='radio'][name='tipo'][value='AR']")
            .first()
            .isVisible()
            .catch(() => false));
        if (
          stableFormFieldsVisible ||
          (/valor\s+para\s+altera|value\s+to\s+change/i.test(bodyText) &&
            /adicionar\s+o\s+valor\s+ao\s+limite\s+atual|add.*value.*current limit/i.test(bodyText))
        ) {
          return scope;
        }
      }

      await this.page.waitForTimeout(500);
    }

    return null;
  }

  private async confirmLimitSubmission(): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await this.dismissBlockingOverlays();

      for (const scope of [this.page, ...this.page.frames()]) {
        const candidates: Locator[] = [
          scope.locator("button.swal2-confirm, input.swal2-confirm").first(),
          scope
            .locator(
              "div[role='dialog'] button, div[role='dialog'] input[type='button'], div[role='dialog'] input[type='submit']",
            )
            .filter({ hasText: /confirmar|sim|alterar|ok/i })
            .first(),
          scope.getByRole("button", { name: /^(?:confirmar|sim|alterar|ok)$/i }).first(),
          scope
            .locator(
              "input[type='button'][value*='Confirmar' i], input[type='button'][value='OK' i], input[type='submit'][value*='Confirmar' i]",
            )
            .first(),
          scope.locator(".swal2-container button:visible, .swal2-container input:visible").first(),
        ];

        for (const candidate of candidates) {
          if (await candidate.isVisible().catch(() => false)) {
            await candidate.click({ force: true }).catch(() => undefined);
            await this.page.waitForTimeout(500);
            return;
          }
        }
      }

      const frameStillOpen = await this.waitForChangeLimitFrame(1_250);
      if (!frameStillOpen) {
        return;
      }
      await this.page.waitForTimeout(750);
    }
  }

  private async dismissBlockingOverlays(): Promise<void> {
    await this.closeChromiumRestoreBubble();
    await this.closeEvaSuggestionPopup();
  }

  private async closeEvaSuggestionPopup(): Promise<void> {
    const scopes: Array<Page | Frame> = [this.page, ...this.page.frames()];
    for (const scope of scopes) {
      const releaseAction = scope.getByText(/liberar restri..o/i).last();
      if (!(await releaseAction.isVisible().catch(() => false))) continue;

      await releaseAction
        .evaluate((element) => {
          const normalize = (value: string) =>
            value
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase();
          let current: HTMLElement | null = element instanceof HTMLElement ? element : element.parentElement;
          let popup: HTMLElement | null = null;

          while (current) {
            const rect = current.getBoundingClientRect();
            const text = normalize(current.innerText ?? current.textContent ?? "");
            if (
              text.includes("posso ajudar") &&
              text.includes("liberar restricao") &&
              rect.width >= 220 &&
              rect.width <= 700 &&
              rect.height >= 180 &&
              rect.height <= 850
            ) {
              popup = current;
              break;
            }
            current = current.parentElement;
          }

          if (!popup) return false;
          const popupRect = popup.getBoundingClientRect();
          const candidates = Array.from(
            popup.querySelectorAll<HTMLElement>("button, [role='button'], a, div, span, svg"),
          )
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const text = normalize(node.innerText ?? node.textContent ?? "");
              const metadata = normalize(
                `${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("title") ?? ""} ${node.className?.toString() ?? ""}`,
              );
              const style = window.getComputedStyle(node);
              const explicitClose = /fechar|close|dismiss/.test(metadata);
              const topRightControl =
                rect.width >= 12 &&
                rect.width <= 72 &&
                rect.height >= 12 &&
                rect.height <= 72 &&
                rect.right >= popupRect.right - 90 &&
                rect.top <= popupRect.top + 90 &&
                !text.includes("liberar restricao") &&
                (node.tagName === "BUTTON" ||
                  node.getAttribute("role") === "button" ||
                  style.cursor === "pointer" ||
                  Boolean(node.querySelector("svg")));
              return { node, rect, explicitClose, topRightControl };
            })
            .filter((candidate) => candidate.explicitClose || candidate.topRightControl)
            .sort((left, right) => {
              if (left.explicitClose !== right.explicitClose) return left.explicitClose ? -1 : 1;
              return right.rect.right - left.rect.right || left.rect.top - right.rect.top;
            });

          const target = candidates[0]?.node;
          if (target) {
            target.click();
            return true;
          }

          const pointTarget = document.elementFromPoint(popupRect.right - 16, popupRect.top + 16);
          const clickable = pointTarget?.closest<HTMLElement>("button, [role='button'], a, div, span");
          if (!clickable) return false;
          clickable.click();
          return true;
        })
        .catch(() => false);

      await this.page.waitForTimeout(300);
      if (await releaseAction.isVisible().catch(() => false)) {
        throw new ManualInterventionError("EVA_SUGGESTION_POPUP_NOT_DISMISSED");
      }
    }
  }

  private async closeChromiumRestoreBubble(): Promise<void> {
    const restoreClose = this.page.getByRole("button", { name: /restore pages\?|fechar|close/i }).last();
    if (await restoreClose.isVisible().catch(() => false)) {
      await restoreClose.click({ force: true }).catch(() => undefined);
      await this.page.waitForTimeout(200);
    }

    const restoreDismiss = this.page.getByText(/chromium didn't shut down correctly|restore pages\?/i).first();
    if (await restoreDismiss.isVisible().catch(() => false)) {
      await this.page.keyboard.press("Escape").catch(() => undefined);
      await this.page.waitForTimeout(200);
    }
  }
}
