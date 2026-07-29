import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { EvaPage } from "./EvaPage.js";

test("opens EVA from a legacy frame and reaches the plate field", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<iframe id='legacy'></iframe>");
    const legacyFrame = page.frames().find((frame) => frame !== page.mainFrame());
    assert.ok(legacyFrame);

    const chatHtml = `
      <body>
        <p>Ola! Sou a EVA, a assistente virtual da Ticket Log.</p>
        <section id="menu">
          <button
            id="transactions"
            onclick="document.querySelector('#menu').hidden = true; document.querySelector('#transactions-menu').hidden = false"
          >Transacoes</button>
        </section>
        <section id="transactions-menu" hidden>
          <button
            id="release"
            onclick="document.querySelector('#transactions-menu').hidden = true; document.querySelector('#plate-form').hidden = false"
          >Liberar abastecimento (restricao)</button>
        </section>
        <section id="plate-form" hidden>
          <textarea aria-label="Placa"></textarea>
          <button>Enviar</button>
        </section>
      </body>
    `;

    await legacyFrame.setContent(`
      <button id="ge-fab">EVA</button>
      <script>
        document.querySelector("#ge-fab").addEventListener("click", () => {
          const chat = document.createElement("iframe");
          chat.srcdoc = ${JSON.stringify(chatHtml)};
          document.body.appendChild(chat);
        });
      </script>
    `);

    const eva = new EvaPage(page);
    assert.equal(await eva.isAvailable(), true);
    await eva.prepareFuelRestrictionDryRun("PWH4E85");

    const chatFrame = page
      .frames()
      .find((frame) => frame !== page.mainFrame() && frame !== legacyFrame);
    assert.ok(chatFrame);
    assert.equal(
      await chatFrame.getByRole("textbox").inputValue(),
      "PWH4E85",
    );
  } finally {
    await browser.close();
  }
});

test("opens EVA when the panel is rendered in the same legacy frame", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<iframe id='legacy'></iframe>");
    const legacyFrame = page.frames().find((frame) => frame !== page.mainFrame());
    assert.ok(legacyFrame);

    await legacyFrame.setContent(`
      <button id="gea-gestor-eva-container">EVA</button>
      <script>
        document.querySelector("#gea-gestor-eva-container").addEventListener("click", () => {
          document.body.insertAdjacentHTML("beforeend", \`
            <section>
              <p>Digite sobre o que deseja falar, ou selecione uma opcao:</p>
              <button id="transactions" onclick="document.querySelector('#release').hidden = false">Transacoes</button>
              <button id="release" hidden onclick="document.querySelector('#plate-form').hidden = false">Liberar abastecimento (restricao)</button>
              <section id="plate-form" hidden>
                <textarea aria-label="Placa"></textarea>
                <button>Enviar</button>
              </section>
            </section>
          \`);
        });
      </script>
    `);

    const eva = new EvaPage(page);
    await eva.prepareFuelRestrictionDryRun("PWH4E85");

    assert.equal(
      await legacyFrame.getByRole("textbox").inputValue(),
      "PWH4E85",
    );
  } finally {
    await browser.close();
  }
});

test("dismisses blocking EVA prompts before opening the operational chat", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <button id="gea-gestor-eva-container">EVA</button>
      <aside id="gea-gestor-eva-ativa-container" style="position:fixed;right:40px;bottom:40px;width:320px;height:240px">
        <button id="button-x" style="position:absolute;right:4px;top:4px">x</button>
        <p>Posso ajudar?</p>
        <p>A fatura vence hoje. Pegue a sua fatura aqui.</p>
      </aside>
      <script>
        document.querySelector("#button-x").addEventListener("click", () => document.querySelector("aside").remove());
        document.querySelector("#gea-gestor-eva-container").addEventListener("click", () => {
          document.body.insertAdjacentHTML("beforeend", \`
            <section>
              <p>Digite sobre o que deseja falar, ou selecione uma opcao:</p>
              <button onclick="document.querySelector('#release').hidden = false">Transacoes</button>
              <button id="release" hidden onclick="document.querySelector('#plate-form').hidden = false">Liberar abastecimento (restricao)</button>
              <section id="plate-form" hidden>
                <textarea aria-label="Placa"></textarea>
                <button>Enviar</button>
              </section>
            </section>
          \`);
        });
      </script>
    `);

    const eva = new EvaPage(page);
    await eva.prepareFuelRestrictionDryRun("PWH4E85");

    assert.equal(await page.locator("#gea-gestor-eva-ativa-container").count(), 0);
    assert.equal(await page.getByRole("textbox").inputValue(), "PWH4E85");
  } finally {
    await browser.close();
  }
});

test("closes an open EVA chat panel after release", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section id="eva-panel" style="position:fixed;right:40px;top:40px;width:320px;height:520px">
        <header>
          <strong>EVA</strong>
          <button id="minimize" style="position:absolute;right:6px;top:6px">-</button>
        </header>
        <p>O que voce quer falar sobre transacoes?</p>
        <p>Pronto! Fiz a liberacao da restricao.</p>
        <textarea aria-label="Digite aqui sua duvida"></textarea>
      </section>
      <script>
        document.querySelector("#minimize").addEventListener("click", () => document.querySelector("#eva-panel").remove());
      </script>
    `);

    const eva = new EvaPage(page);
    assert.equal(await eva.closePanelIfOpen(), true);
    assert.equal(await page.locator("#eva-panel").count(), 0);
  } finally {
    await browser.close();
  }
});
