export interface OutboundWhatsappMessage {
  toPhoneE164: string;
  body: string;
  replyToMessageId?: string;
}

export interface WhatsappOption {
  id: string;
  title: string;
}

export interface SentWhatsappMessage {
  providerMessageId: string | null;
}

export interface WhatsappProvider {
  sendTextMessage(message: OutboundWhatsappMessage): Promise<SentWhatsappMessage>;
  sendOptionsMessage?(
    message: OutboundWhatsappMessage & {
      options: WhatsappOption[];
    },
  ): Promise<SentWhatsappMessage>;
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
    return this.sendPayload({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: message.toPhoneE164.replace(/^\+/, ""),
      type: "text",
      context: message.replyToMessageId ? { message_id: message.replyToMessageId } : undefined,
      text: {
        preview_url: false,
        body: message.body,
      },
    });
  }

  async sendOptionsMessage(
    message: OutboundWhatsappMessage & {
      options: WhatsappOption[];
    },
  ): Promise<SentWhatsappMessage> {
    if (!message.options.length || message.options.length > 3) {
      return this.sendTextMessage(message);
    }

    return this.sendPayload({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: message.toPhoneE164.replace(/^\+/, ""),
      type: "interactive",
      context: message.replyToMessageId ? { message_id: message.replyToMessageId } : undefined,
      interactive: {
        type: "button",
        body: {
          text: message.body,
        },
        action: {
          buttons: message.options.map((option) => ({
            type: "reply",
            reply: {
              id: option.id,
              title: option.title,
            },
          })),
        },
      },
    });
  }

  private async sendPayload(requestPayload: unknown): Promise<SentWhatsappMessage> {
    const response = await fetch(
      `${this.input.apiBaseUrl.replace(/\/$/, "")}/${this.input.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.input.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`WHATSAPP_SEND_FAILED:${response.status}:${text.slice(0, 200)}`);
    }

    const responsePayload = (await response.json()) as {
      messages?: Array<{ id?: string }>;
    };
    return {
      providerMessageId: responsePayload.messages?.[0]?.id ?? null,
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
