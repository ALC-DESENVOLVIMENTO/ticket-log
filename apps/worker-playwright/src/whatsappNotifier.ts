import { createWhatsappProvider } from "@ticketlog/whatsapp";
import { formatAppDateTime, formatRequestProtocol } from "@ticketlog/domain";
import {
  findRequestNotification,
  getRequestNotificationContext,
  markRequestNotification,
  recordWhatsappMessage,
} from "@ticketlog/db";

function formatCurrency(value: number | string | null | undefined): string {
  const numeric = value === null || value === undefined ? null : Number(value);
  if (numeric === null || !Number.isFinite(numeric)) return "n/d";
  return numeric.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const provider = createWhatsappProvider({
  apiBaseUrl: process.env.WHATSAPP_API_BASE_URL,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
});
const whatsappConfigured = Boolean(
  process.env.WHATSAPP_API_BASE_URL && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN,
);

async function sendText(phoneE164: string, body: string, requestId: string): Promise<void> {
  if (!whatsappConfigured) {
    throw new Error("WHATSAPP_PROVIDER_NOT_CONFIGURED_IN_WORKER");
  }
  const sent = await provider.sendTextMessage({
    toPhoneE164: phoneE164,
    body,
  });
  if (!sent.providerMessageId) {
    throw new Error("WHATSAPP_PROVIDER_DID_NOT_RETURN_MESSAGE_ID");
  }
  await recordWhatsappMessage({
    providerMessageId: sent.providerMessageId,
    phoneE164,
    direction: "out",
    requestId,
    body,
  });
}

export async function notifyWhatsappResolvedRequest(requestId: string): Promise<void> {
  const context = await getRequestNotificationContext(requestId);
  if (!context || context.request.channel !== "whatsapp" || !context.requesterPhoneE164) {
    return;
  }

  const eventKey = context.request.status === "CONCLUIDA" ? "REQUEST_COMPLETED" : `REQUEST_STATUS:${context.request.status}`;
  const existing = await findRequestNotification({
    requestId,
    eventKey,
    channel: "whatsapp",
  });
  if (existing?.status === "sent") {
    return;
  }

  const protocol = formatRequestProtocol(context.request.id);
  const changeLimitDone = context.steps.some((step) => step.step_key === "CHANGE_LIMIT" && step.status === "DONE");
  const evaFailed = context.steps.some((step) => step.step_key === "EVA_RELEASE" && step.status === "FAILED");

  const body =
    context.request.status === "CONCLUIDA"
      ? [
          "Alteracao realizada com sucesso.",
          `Placa: ${context.request.vehicle_plate}`,
          `Limite anterior: ${formatCurrency(context.request.previous_limit)}`,
          `Novo limite: ${formatCurrency(context.request.new_limit)}`,
          `Data e hora: ${formatAppDateTime(new Date())}`,
          `Protocolo: ${protocol}`,
        ].join("\n")
      : changeLimitDone && evaFailed
        ? [
            "O limite foi alterado com sucesso, mas a liberacao complementar ainda nao foi concluida.",
            `Placa: ${context.request.vehicle_plate}`,
            `Limite anterior: ${formatCurrency(context.request.previous_limit)}`,
            `Novo limite: ${formatCurrency(context.request.new_limit)}`,
            "Nossa equipe vai continuar a tratativa operacional.",
            `Protocolo: ${protocol}`,
          ].join("\n")
        : [
            "Nao foi possivel concluir a alteracao neste momento.",
            "Entre em contato novamente daqui a 30 minutos.",
            `Protocolo: ${protocol}`,
            `Placa: ${context.request.vehicle_plate}`,
          ].join("\n");

  try {
    await sendText(context.requesterPhoneE164, body, context.request.id);
    await markRequestNotification({
      requestId: context.request.id,
      eventKey,
      channel: "whatsapp",
      recipientPhoneE164: context.requesterPhoneE164,
      status: "sent",
    });
  } catch (error) {
    console.error(
      {
        requestId,
        eventKey,
        errorName: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      "whatsappNotifier:send-failed",
    );
    await markRequestNotification({
      requestId: context.request.id,
      eventKey,
      channel: "whatsapp",
      recipientPhoneE164: context.requesterPhoneE164,
      status: "failed",
    });
  }
}

export async function notifyWhatsappRetryScheduled(
  requestId: string,
  stepKey: "CHANGE_LIMIT" | "EVA_RELEASE",
): Promise<void> {
  const context = await getRequestNotificationContext(requestId);
  if (!context || context.request.channel !== "whatsapp" || !context.requesterPhoneE164) {
    return;
  }

  const eventKey = `REQUEST_RETRYING:${stepKey}`;
  const existing = await findRequestNotification({
    requestId,
    eventKey,
    channel: "whatsapp",
  });
  if (existing?.status === "sent") return;

  const body =
    stepKey === "EVA_RELEASE"
      ? [
          "O limite ja foi alterado. A liberacao complementar encontrou uma instabilidade e sera tentada novamente automaticamente.",
          "Nao e necessario abrir outro chamado agora.",
          `Protocolo: ${formatRequestProtocol(context.request.id)}`,
        ].join("\n")
      : [
          "A Ticket Log apresentou uma instabilidade temporaria.",
          "A solicitacao sera tentada novamente automaticamente.",
          `Protocolo: ${formatRequestProtocol(context.request.id)}`,
        ].join("\n");

  await sendText(context.requesterPhoneE164, body, context.request.id);
  await markRequestNotification({
    requestId: context.request.id,
    eventKey,
    channel: "whatsapp",
    recipientPhoneE164: context.requesterPhoneE164,
    status: "sent",
  });
}
