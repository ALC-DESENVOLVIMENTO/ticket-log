import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { ManualInterventionError } from "@ticketlog/domain";
import { OfficialApiTicketLogProvider } from "./officialApiProvider.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    TICKETLOG_API_BASE_URL: "https://srv1.ticketlog.com.br",
    TICKETLOG_API_BASIC_TOKEN: "secret-token",
    TICKETLOG_CODIGO_CLIENTE: "249701",
    TICKETLOG_CODIGO_PRODUTO: "4",
    TICKETLOG_API_PLATE_CARD_MAP: '{"PWH4E85":"6035740000001512"}',
    TICKETLOG_REAL_EXECUTION: "true",
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

test("reads current limit using the configured plate/card map", async () => {
  globalThis.fetch = mockFetch([
    {
      match: "/usuarioCartaoLimite/6035740000001512?",
      response: { limites: [{ numeroCartao: "6035740000001512", valorLimite: 80 }] },
    },
  ]);

  const provider = new OfficialApiTicketLogProvider();
  const limit = await provider.readCurrentLimit({ requestId: "req-1", vehiclePlate: "PWH4E85" });

  assert.equal(limit, 80);
});

test("changes limit with add-to-current temporary payload and confirms by readback", async () => {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = mockFetch(
    [
      {
        match: "/usuarioCartaoLimite/6035740000001512?",
        response: { limites: [{ numeroCartao: "6035740000001512", valorLimite: 80 }] },
      },
      {
        match: "/usuarioCartaoLimite",
        method: "PUT",
        response: { sucesso: true },
      },
      {
        match: "/usuarioCartaoLimite/6035740000001512?",
        response: { limites: [{ numeroCartao: "6035740000001512", valorLimite: 90 }] },
      },
    ],
    calls,
  );

  const provider = new OfficialApiTicketLogProvider();
  const result = await provider.changeLimit({
    requestId: "req-2",
    vehiclePlate: "PWH4E85",
    requestedAmount: 10,
  });

  const updateCall = calls.find((call) => call.method === "PUT");
  assert.ok(updateCall);
  assert.deepEqual(updateCall.body, {
    codigoCliente: 249701,
    codigoProduto: 4,
    tipoAlteracao: "AR",
    tipoLimite: "AS",
    tipoOperacao: "SP",
    cartoes: [
      {
        numeroCartao: "6035740000001512",
        valorLimite: 10,
        valorLimiteProxPeriodo: 0,
        mensagem: ".",
      },
    ],
  });
  assert.equal(result.previousLimit, 80);
  assert.equal(result.newLimit, 90);
  assert.equal(result.platformResult, "API_CHANGE_LIMIT_CONFIRMED");
});

test("does not mutate when real execution is disabled", async () => {
  process.env.TICKETLOG_REAL_EXECUTION = "false";
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}");
  }) as typeof fetch;

  const provider = new OfficialApiTicketLogProvider();
  await assert.rejects(
    () => provider.changeLimit({ requestId: "req-3", vehiclePlate: "PWH4E85", requestedAmount: 10 }),
    (error) => error instanceof ManualInterventionError && error.code === "TICKETLOG_REAL_EXECUTION_DISABLED",
  );
  assert.equal(called, false);
});

function mockFetch(
  fixtures: Array<{ match: string; method?: string; response: unknown; status?: number }>,
  calls: Array<{ url: string; method: string; body?: unknown }> = [],
): typeof fetch {
  let index = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });

    const fixture = fixtures[index++];
    assert.ok(fixture, `Unexpected fetch call: ${method} ${url}`);
    assert.ok(url.includes(fixture.match), `Expected URL containing ${fixture.match}, got ${url}`);
    assert.equal(method, fixture.method ?? "GET");

    return new Response(JSON.stringify(fixture.response), {
      status: fixture.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}
