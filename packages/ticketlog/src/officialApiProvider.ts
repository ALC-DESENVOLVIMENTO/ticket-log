import {
  IndeterminateResultError,
  ManualInterventionError,
  ReprocessableAutomationError,
  normalizePlate,
} from "@ticketlog/domain";
import type { TicketLogLimitInput, TicketLogLimitResult, TicketLogProvider } from "./provider.js";

type JsonRecord = Record<string, unknown>;

interface TicketLogApiConfig {
  baseUrl: string;
  basicToken: string;
  codigoCliente: number;
  codigoProduto: number;
  tipoLimite: string;
  tipoAlteracao: string;
  tipoOperacao: string;
  limitMessage: string;
  releaseDays: number;
  allowReleaseWithoutTransaction: boolean;
  plateCardMap: Map<string, string>;
}

interface ResolvedCard {
  numeroCartao: string;
  source: "env-map" | "protected-transactions";
}

interface ProtectedTransaction {
  codigoTransacaoNaoAutorizada: string | number | null;
  codigoTipoLiberacaoRestricao: string | number | null;
  numeroCartao: string | null;
  placa: string | null;
}

const DEFAULT_BASE_URL = "https://srv1.ticketlog.com.br";
const API_PATH = "/ticketlog-servicos/ebs";

export class OfficialApiTicketLogProvider implements TicketLogProvider {
  constructor(private readonly fallback?: TicketLogProvider) {}

  async readCurrentLimit(input: Pick<TicketLogLimitInput, "requestId" | "vehiclePlate">): Promise<number | null> {
    try {
      const config = loadConfig();
      const card = await this.resolveCard(config, input.vehiclePlate);
      return await this.readLimitForCard(config, card.numeroCartao);
    } catch (error) {
      if (this.fallback && canFallbackBeforeMutation(error)) {
        return this.fallback.readCurrentLimit(input);
      }
      throw error;
    }
  }

  async changeLimit(input: TicketLogLimitInput): Promise<TicketLogLimitResult> {
    const config = loadConfig();
    assertRealExecutionEnabled();

    let card: ResolvedCard;
    try {
      card = await this.resolveCard(config, input.vehiclePlate);
    } catch (error) {
      if (this.fallback && canFallbackBeforeMutation(error)) {
        return this.fallback.changeLimit(input);
      }
      throw error;
    }

    let previousLimit: number | null;
    try {
      previousLimit = await this.readLimitForCard(config, card.numeroCartao);
    } catch (error) {
      if (this.fallback && canFallbackBeforeMutation(error)) {
        return this.fallback.changeLimit(input);
      }
      throw error;
    }
    const body = {
      codigoCliente: config.codigoCliente,
      codigoProduto: config.codigoProduto,
      tipoAlteracao: config.tipoAlteracao,
      tipoLimite: config.tipoLimite,
      tipoOperacao: config.tipoOperacao,
      cartoes: [
        {
          numeroCartao: card.numeroCartao,
          valorLimite: input.requestedAmount,
          valorLimiteProxPeriodo: 0,
          mensagem: config.limitMessage,
        },
      ],
    };

    const response = await this.request<JsonRecord>(config, "/usuarioCartaoLimite", {
      method: "PUT",
      body,
      errorCode: "TICKETLOG_API_CHANGE_LIMIT_HTTP_FAILED",
    });

    if (!isApiSuccess(response)) {
      throw new ReprocessableAutomationError("TICKETLOG_API_CHANGE_LIMIT_FAILED", getResponseMessage(response));
    }

    const newLimit = await this.readLimitForCard(config, card.numeroCartao).catch(() => null);
    if (previousLimit !== null && newLimit !== null) {
      const expected = roundMoney(previousLimit + input.requestedAmount);
      if (Math.abs(roundMoney(newLimit) - expected) > 0.01) {
        throw new IndeterminateResultError("TICKETLOG_API_CHANGE_LIMIT_READBACK_MISMATCH");
      }
    }

    return {
      previousLimit,
      addedAmount: input.requestedAmount,
      newLimit,
      platformResult: newLimit === null ? "API_CHANGE_LIMIT_ACCEPTED_WITHOUT_READBACK" : "API_CHANGE_LIMIT_CONFIRMED",
    };
  }

  async releaseEvaOnly(input: Pick<TicketLogLimitInput, "requestId" | "vehiclePlate">): Promise<void> {
    const config = loadConfig();
    assertRealExecutionEnabled();

    let card: ResolvedCard;
    try {
      card = await this.resolveCard(config, input.vehiclePlate);
    } catch (error) {
      if (this.fallback && canFallbackBeforeMutation(error)) {
        return this.fallback.releaseEvaOnly(input);
      }
      throw error;
    }

    let transaction: ProtectedTransaction | null;
    try {
      transaction = await this.findLatestProtectedTransaction(config, input.vehiclePlate, card.numeroCartao);
    } catch (error) {
      if (this.fallback && canFallbackBeforeMutation(error)) {
        return this.fallback.releaseEvaOnly(input);
      }
      throw error;
    }
    if (!transaction?.codigoTransacaoNaoAutorizada) {
      if (config.allowReleaseWithoutTransaction) {
        console.info(
          {
            requestId: input.requestId,
            plate: normalizePlate(input.vehiclePlate),
            provider: "ticketlog-api",
          },
          "ticketlog.api.release:no-protected-transaction",
        );
        return;
      }
      throw new ReprocessableAutomationError("TICKETLOG_API_RELEASE_TRANSACTION_NOT_FOUND");
    }

    const tipoLiberacao = pickString(
      transaction.codigoTipoLiberacaoRestricao,
      process.env.TICKETLOG_API_DEFAULT_TIPO_LIBERACAO_RESTRICAO,
    );
    const body: JsonRecord = {
      codigoCliente: config.codigoCliente,
      codigoProduto: config.codigoProduto,
      numeroCartao: card.numeroCartao,
      codigoTransacaoNaoAutorizada: transaction.codigoTransacaoNaoAutorizada,
      dataValidade: formatIsoDate(addDays(new Date(), config.releaseDays)),
      motivo: process.env.TICKETLOG_API_RELEASE_REASON ?? ".",
      motivoLiberacaoRestricao: process.env.TICKETLOG_API_RELEASE_REASON ?? ".",
    };

    if (tipoLiberacao) {
      body.liberacaoRestricaoGrupos = [{ codigoTipoLiberacaoRestricao: toNumberOrString(tipoLiberacao) }];
    }

    const response = await this.request<JsonRecord>(config, "/liberacaoRestricao", {
      method: "POST",
      body,
      errorCode: "TICKETLOG_API_RELEASE_HTTP_FAILED",
    });

    if (!isApiSuccess(response)) {
      throw new ReprocessableAutomationError("TICKETLOG_API_RELEASE_FAILED", getResponseMessage(response));
    }
  }

  private async resolveCard(config: TicketLogApiConfig, plateInput: string): Promise<ResolvedCard> {
    const plate = normalizePlate(plateInput);
    const mappedCard = config.plateCardMap.get(plate);
    if (mappedCard) {
      return { numeroCartao: mappedCard, source: "env-map" };
    }

    const transaction = await this.findLatestProtectedTransaction(config, plate);
    if (transaction?.numeroCartao) {
      return { numeroCartao: transaction.numeroCartao, source: "protected-transactions" };
    }

    throw new ManualInterventionError(
      "TICKETLOG_API_CARD_NOT_RESOLVED",
      "TICKETLOG_API_CARD_NOT_RESOLVED: configure TICKETLOG_API_PLATE_CARD_MAP for this plate",
    );
  }

  private async readLimitForCard(config: TicketLogApiConfig, numeroCartao: string): Promise<number | null> {
    const query = new URLSearchParams({
      codigoCliente: String(config.codigoCliente),
      codigoProduto: String(config.codigoProduto),
      tipoLimite: config.tipoLimite,
    });
    const response = await this.request<unknown>(config, `/usuarioCartaoLimite/${encodeURIComponent(numeroCartao)}?${query}`, {
      method: "GET",
      errorCode: "TICKETLOG_API_READ_LIMIT_HTTP_FAILED",
    });
    return extractLimit(response);
  }

  private async findLatestProtectedTransaction(
    config: TicketLogApiConfig,
    plateInput: string,
    numeroCartao?: string,
  ): Promise<ProtectedTransaction | null> {
    const plate = normalizePlate(plateInput);
    const body: JsonRecord = {
      codigoCliente: config.codigoCliente,
      codigoProduto: config.codigoProduto,
      placaVeiculo: plate,
      dataInicialPeriodo: formatReportDate(addDays(new Date(), -7)),
      dataFinalPeriodo: formatReportDate(new Date()),
    };
    if (numeroCartao) {
      body.numeroCartao = numeroCartao;
    }

    const response = await this.request<unknown>(config, "/RelatorioTransacoesProtegidas/search", {
      method: "POST",
      body,
      errorCode: "TICKETLOG_API_PROTECTED_TRANSACTIONS_HTTP_FAILED",
    });

    const rows = extractRows(response)
      .map(toProtectedTransaction)
      .filter((row): row is ProtectedTransaction => {
        if (!row) return false;
        return row.placa ? normalizePlate(row.placa) === plate : Boolean(row.numeroCartao);
      });

    return rows[0] ?? null;
  }

  private async request<T>(
    config: TicketLogApiConfig,
    pathAndQuery: string,
    input: { method: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown; errorCode: string },
  ): Promise<T> {
    const url = `${config.baseUrl}${API_PATH}${pathAndQuery}`;
    const response = await fetch(url, {
      method: input.method,
      headers: {
        Authorization: `Basic ${config.basicToken}`,
        Accept: "application/json",
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    });

    const text = await response.text();
    const payload = parseJson(text);

    if (!response.ok) {
      throw new ReprocessableAutomationError(
        input.errorCode,
        `${input.errorCode}: HTTP ${response.status} ${sanitizeApiMessage(payload ?? text)}`,
      );
    }

    return (payload ?? {}) as T;
  }
}

function loadConfig(): TicketLogApiConfig {
  const basicToken = process.env.TICKETLOG_API_BASIC_TOKEN?.trim();
  const codigoCliente = Number(process.env.TICKETLOG_CODIGO_CLIENTE);
  const codigoProduto = Number(process.env.TICKETLOG_CODIGO_PRODUTO);

  if (!basicToken || !Number.isFinite(codigoCliente) || !Number.isFinite(codigoProduto)) {
    throw new ManualInterventionError("TICKETLOG_API_NOT_CONFIGURED");
  }

  return {
    baseUrl: (process.env.TICKETLOG_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    basicToken,
    codigoCliente,
    codigoProduto,
    tipoLimite: process.env.TICKETLOG_API_TIPO_LIMITE ?? "AS",
    tipoAlteracao: process.env.TICKETLOG_API_TIPO_ALTERACAO ?? "AR",
    tipoOperacao: process.env.TICKETLOG_API_TIPO_OPERACAO ?? "SP",
    limitMessage: process.env.TICKETLOG_API_LIMIT_MESSAGE ?? ".",
    releaseDays: Number(process.env.TICKETLOG_API_RELEASE_DAYS ?? 1),
    allowReleaseWithoutTransaction: process.env.TICKETLOG_API_ALLOW_NO_RELEASE_TRANSACTION !== "false",
    plateCardMap: parsePlateCardMap(process.env.TICKETLOG_API_PLATE_CARD_MAP),
  };
}

function assertRealExecutionEnabled(): void {
  if (process.env.TICKETLOG_REAL_EXECUTION !== "true") {
    throw new ManualInterventionError("TICKETLOG_REAL_EXECUTION_DISABLED");
  }
}

function canFallbackBeforeMutation(error: unknown): boolean {
  if (error instanceof ManualInterventionError) {
    return error.code === "TICKETLOG_API_CARD_NOT_RESOLVED" || error.code === "TICKETLOG_API_NOT_CONFIGURED";
  }
  if (error instanceof ReprocessableAutomationError) {
    return [
      "TICKETLOG_API_PROTECTED_TRANSACTIONS_HTTP_FAILED",
      "TICKETLOG_API_READ_LIMIT_HTTP_FAILED",
    ].includes(error.code);
  }
  return false;
}

function parsePlateCardMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw?.trim()) return map;

  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, string | number>;
    for (const [plate, card] of Object.entries(parsed)) {
      map.set(normalizePlate(plate), String(card).replace(/\D/g, ""));
    }
    return map;
  }

  for (const item of trimmed.split(/[;\n,]+/)) {
    const [plate, card] = item.split(/[=:]/).map((part) => part?.trim());
    if (plate && card) {
      map.set(normalizePlate(plate), card.replace(/\D/g, ""));
    }
  }
  return map;
}

function parseJson(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isApiSuccess(response: unknown): boolean {
  if (!isRecord(response)) return true;
  const value = response.sucesso ?? response.success ?? response.status;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return !["false", "erro", "error", "failed"].includes(value.toLowerCase());
  return true;
}

function getResponseMessage(response: unknown): string {
  if (!isRecord(response)) return "TICKETLOG_API_RESPONSE_NOT_SUCCESSFUL";
  return String(response.mensagem ?? response.message ?? response.erro ?? response.error ?? "TICKETLOG_API_RESPONSE_NOT_SUCCESSFUL");
}

function sanitizeApiMessage(input: unknown): string {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return text.replace(/Basic\s+[A-Za-z0-9+/=._-]+/gi, "Basic ***").slice(0, 500);
}

function extractLimit(response: unknown): number | null {
  const rows = extractRows(response);
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const candidate = pickNumber(row.valorLimite, row.limiteAtual, row.valorLimiteAtual, row.limite);
    if (candidate !== null) return candidate;
  }
  if (isRecord(response)) {
    return pickNumber(response.valorLimite, response.limiteAtual, response.valorLimiteAtual, response.limite);
  }
  return null;
}

function extractRows(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (!isRecord(response)) return [];
  for (const key of ["itens", "items", "content", "data", "resultado", "result", "limites"]) {
    const value = response[key];
    if (Array.isArray(value)) return value;
  }
  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function toProtectedTransaction(input: unknown): ProtectedTransaction | null {
  if (!isRecord(input)) return null;
  return {
    codigoTransacaoNaoAutorizada: pickString(input.codigoTransacaoNaoAutorizada, input.codigoTransacao, input.idTransacao),
    codigoTipoLiberacaoRestricao: pickString(input.codigoTipoLiberacaoRestricao, input.tipoLiberacaoRestricao),
    numeroCartao: pickString(input.numeroCartao, input.cartao),
    placa: pickString(input.placa, input.placaVeiculo),
  };
}

function isRecord(input: unknown): input is JsonRecord {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function toNumberOrString(value: string): number | string {
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatReportDate(date: Date): number | string {
  const format = process.env.TICKETLOG_API_REPORT_DATE_FORMAT ?? "YYYYMMDD";
  if (format === "ISO") return formatIsoDate(date);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return Number(`${year}${month}${day}`);
}
