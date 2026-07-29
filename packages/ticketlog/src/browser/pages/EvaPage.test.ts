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
