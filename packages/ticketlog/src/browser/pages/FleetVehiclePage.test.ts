import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { FleetVehiclePage } from "./FleetVehiclePage.js";

test("returns to Home through the icon-only legacy entrypoint", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route(
      "https://plataforma.ticketlog.com.br/GoodManagerSSL/Home2.cfm?load_menu=false",
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<p>Legacy Home loaded</p>",
        }),
    );
    await page.setContent(`
      <style>
        .menu-pagina-inicial {
          display: inline-block;
          width: 24px;
          height: 22px;
        }
      </style>
      <a
        class="menu-pagina-inicial"
        href="https://plataforma.ticketlog.com.br/GoodManagerSSL/Home2.cfm?load_menu=false"
        title="Página Inicial"
      ></a>
    `);

    const fleet = new FleetVehiclePage(page);
    await fleet.gotoHome();

    assert.match(page.url(), /GoodManagerSSL\/Home2\.cfm/i);
  } finally {
    await browser.close();
  }
});
