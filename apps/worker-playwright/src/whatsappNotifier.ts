import { createWhatsappProvider } from "@ticketlog/whatsapp";
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

async function sendText(phoneE164: string, body: string, requestId: string): Promise<void> {
  const sent = await provider.sendTextMessage({
    toPhoneE164: phoneE164,
    body,
  });
  await recordWhatsappMessage({
    providerMessageId: sent.providerMessageId ?? undefined,
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

  const body =
    context.request.status === "CONCLUIDA"
      ? [
          "Alteracao realizada com sucesso.",
          `Placa: ${context.request.vehicle_plate}`,
          `Limite anterior: ${formatCurrency(context.request.previous_limit)}`,
          `Novo limite: ${formatCurrency(context.request.new_limit)}`,
          `Data e hora: ${new Date().toLocaleString("pt-BR")}`,
          `Protocolo: ${context.request.id}`,
        ].join("\n")
      : "Nao foi possivel concluir a alteracao neste momento. Entre em contato novamente daqui a 30 minutos.";

  await sendText(context.requesterPhoneE164, body, context.request.id);
  await markRequestNotification({
    requestId: context.request.id,
    eventKey,
    channel: "whatsapp",
    recipientPhoneE164: context.requesterPhoneE164,
    status: "sent",
  });
}
