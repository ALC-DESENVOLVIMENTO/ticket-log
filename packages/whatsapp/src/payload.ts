export interface InboundWhatsappMessage {
  providerMessageId: string;
  phoneE164: string;
  text: string;
}

export function extractMetaMessages(payload: any): InboundWhatsappMessage[] {
  const entries = payload?.entry ?? [];
  const messages: InboundWhatsappMessage[] = [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      for (const message of value?.messages ?? []) {
        const text =
          message?.text?.body ??
          message?.interactive?.button_reply?.id ??
          message?.interactive?.button_reply?.title ??
          message?.button?.text ??
          message?.interactive?.list_reply?.id ??
          message?.interactive?.list_reply?.title;
        const phone = message?.from;
        if (message.id && phone && text) {
          messages.push({
            providerMessageId: message.id,
            phoneE164: phone.startsWith("+") ? phone : `+${phone}`,
            text,
          });
        }
      }
    }
  }

  return messages;
}
