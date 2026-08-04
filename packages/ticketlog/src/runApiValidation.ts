import { normalizePlate } from "@ticketlog/domain";

const baseUrl = (process.env.TICKETLOG_API_BASE_URL ?? "https://srv1.ticketlog.com.br").replace(/\/+$/, "");
const token = process.env.TICKETLOG_API_BASIC_TOKEN;
const codigoCliente = Number(process.env.TICKETLOG_CODIGO_CLIENTE);
const codigoProduto = Number(process.env.TICKETLOG_CODIGO_PRODUTO);
const plate = normalizePlate(process.env.TICKETLOG_VALIDATE_PLATE ?? "");
const tipoLimite = process.env.TICKETLOG_API_TIPO_LIMITE ?? "AS";

if (!token || !Number.isFinite(codigoCliente) || !Number.isFinite(codigoProduto)) {
  console.error("TICKETLOG_API_BASIC_TOKEN, TICKETLOG_CODIGO_CLIENTE e TICKETLOG_CODIGO_PRODUTO sao obrigatorios");
  process.exit(1);
}

if (!plate) {
  console.error("TICKETLOG_VALIDATE_PLATE e obrigatorio");
  process.exit(1);
}

const output: Record<string, unknown> = {
  plate,
  baseUrl,
  codigoCliente,
  codigoProduto,
  checks: [],
};

const checks = output.checks as Array<Record<string, unknown>>;

try {
  const vehicleCode = await request(
    `/entidadeDominio/buscaCodigoVeiculo/${codigoCliente}/${codigoProduto}/${encodeURIComponent(plate)}`,
    "GET",
  );
  checks.push({ key: "VEHICLE_CODE_BY_PLATE", ok: true, sample: summarize(vehicleCode) });
} catch (error) {
  checks.push({ key: "VEHICLE_CODE_BY_PLATE", ok: false, error: errorMessage(error) });
}

let numeroCartao = resolveCardFromEnv(plate);
try {
  const transactions = await request("/RelatorioTransacoesProtegidas/search", "POST", {
    codigoCliente,
    codigoProduto,
    placaVeiculo: plate,
    dataInicialPeriodo: formatReportDate(addDays(new Date(), -7)),
    dataFinalPeriodo: formatReportDate(new Date()),
  });
  const rows = extractRows(transactions);
  numeroCartao ??= rows.map((row) => readString(row, "numeroCartao")).find(Boolean) ?? null;
  checks.push({ key: "PROTECTED_TRANSACTIONS", ok: true, count: rows.length, sample: summarize(rows[0]) });
} catch (error) {
  checks.push({ key: "PROTECTED_TRANSACTIONS", ok: false, error: errorMessage(error) });
}

if (numeroCartao) {
  try {
    const query = new URLSearchParams({
      codigoCliente: String(codigoCliente),
      codigoProduto: String(codigoProduto),
      tipoLimite,
    });
    const limits = await request(`/usuarioCartaoLimite/${encodeURIComponent(numeroCartao)}?${query}`, "GET");
    checks.push({ key: "CARD_LIMIT", ok: true, numeroCartao: maskCard(numeroCartao), sample: summarize(limits) });
  } catch (error) {
    checks.push({ key: "CARD_LIMIT", ok: false, numeroCartao: maskCard(numeroCartao), error: errorMessage(error) });
  }

  try {
    const block = await request(`/entidadeDominio/buscaCodigoBloqueio/${codigoCliente}/${codigoProduto}/${encodeURIComponent(numeroCartao)}`, "GET");
    checks.push({ key: "CARD_BLOCK_CODE", ok: true, numeroCartao: maskCard(numeroCartao), sample: summarize(block) });
  } catch (error) {
    checks.push({ key: "CARD_BLOCK_CODE", ok: false, numeroCartao: maskCard(numeroCartao), error: errorMessage(error) });
  }
} else {
  checks.push({
    key: "CARD_LIMIT",
    ok: false,
    error: "numeroCartao nao encontrado. Configure TICKETLOG_API_PLATE_CARD_MAP ou gere uma transacao protegida para consulta.",
  });
}

console.log(JSON.stringify(output, null, 2));

async function request(pathAndQuery: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}/ticketlog-servicos/ebs${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Basic ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${sanitize(payload ?? text)}`);
  }
  return payload;
}

function resolveCardFromEnv(plateInput: string): string | null {
  const raw = process.env.TICKETLOG_API_PLATE_CARD_MAP?.trim();
  if (!raw) return null;
  if (raw.startsWith("{")) {
    const parsed = JSON.parse(raw) as Record<string, string | number>;
    return parsed[plateInput] ? String(parsed[plateInput]).replace(/\D/g, "") : null;
  }
  for (const entry of raw.split(/[;\n,]+/)) {
    const [mapPlate, card] = entry.split(/[=:]/).map((part) => part?.trim());
    if (normalizePlate(mapPlate ?? "") === plateInput && card) return card.replace(/\D/g, "");
  }
  return null;
}

function extractRows(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;
  for (const key of ["itens", "items", "content", "data", "resultado", "result"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}

function readString(input: unknown, key: string): string | null {
  if (!input || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function parseJson(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function summarize(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  return JSON.parse(sanitize(JSON.stringify(value).slice(0, 1000))) as unknown;
}

function sanitize(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/\d{6,}/g, (match) => (match.length >= 12 ? maskCard(match) : match));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? sanitize(error.message) : sanitize(String(error));
}

function maskCard(card: string): string {
  const clean = card.replace(/\D/g, "");
  if (clean.length <= 8) return "****";
  return `${clean.slice(0, 4)}********${clean.slice(-4)}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatReportDate(date: Date): number {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return Number(`${year}${month}${day}`);
}
