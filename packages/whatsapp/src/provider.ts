export interface OutboundWhatsappMessage {
  toPhoneE164: string;
  body: string;
  replyToMessageId?: string;
}

export interface SentWhatsappMessage {
  providerMessageId: string | null;
}

export interface WhatsappProvider {
  sendTextMessage(message: OutboundWhatsappMessage): Promise<SentWhatsappMessage>;
}

export class NoopWhatsappProvider implements WhatsappProvider {
  async sendTextMessage(): Promise<SentWhatsappMessage> {
    return { providerMessageId: null };
  }
}

export class MetaWhatsappCloudProvider implements WhatsappProvider {
  constructor(
    private readonly input: {
      apiBaseUrl: string;
      phoneNumberId: string;
      accessToken: string;
    },
  ) {}

  async sendTextMessage(message: OutboundWhatsappMessage): Promise<SentWhatsappMessage> {
    const response = await fetch(
      `${this.input.apiBaseUrl.replace(/\/$/, "")}/${this.input.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.input.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: message.toPhoneE164.replace(/^\+/, ""),
          type: "text",
          context: message.replyToMessageId ? { message_id: message.replyToMessageId } : undefined,
          text: {
            preview_url: false,
            body: message.body,
          },
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`WHATSAPP_SEND_FAILED:${response.status}:${text.slice(0, 200)}`);
    }

    const payload = (await response.json()) as {
      messages?: Array<{ id?: string }>;
    };
    return {
      providerMessageId: payload.messages?.[0]?.id ?? null,
    };
  }
}

export function createWhatsappProvider(input: {
  apiBaseUrl?: string;
  phoneNumberId?: string;
  accessToken?: string;
}): WhatsappProvider {
  if (!input.apiBaseUrl || !input.phoneNumberId || !input.accessToken) {
    return new NoopWhatsappProvider();
  }

  return new MetaWhatsappCloudProvider({
    apiBaseUrl: input.apiBaseUrl,
    phoneNumberId: input.phoneNumberId,
    accessToken: input.accessToken,
  });
}
