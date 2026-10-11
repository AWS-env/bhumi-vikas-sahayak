import { createHmac, timingSafeEqual } from "node:crypto";
import { after, type NextRequest } from "next/server";

// WhatsApp Cloud API webhook. Lives outside /api so proxy.ts lets Meta through
// without a Supabase session; requests are authenticated by Meta's signature.

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0";

type IncomingMessage = { from: string; id: string; type: string; text?: { body: string } };
type WebhookPayload = {
  entry?: {
    changes?: {
      field: string;
      value: { metadata?: { phone_number_id: string }; messages?: IncomingMessage[] };
    }[];
  }[];
};

// Meta calls this once when the callback URL is saved.
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (
    expected &&
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === expected
  ) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!isSignedByMeta(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("invalid signature", { status: 401 });
  }

  const payload = JSON.parse(raw) as WebhookPayload;
  // Ack immediately; Meta retries if we take too long, so reply after the response.
  after(() => handle(payload));
  return new Response("ok", { status: 200 });
}

function isSignedByMeta(raw: string, header: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function handle(payload: WebhookPayload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId = change.value.metadata?.phone_number_id;
      if (change.field !== "messages" || !phoneNumberId) continue;
      // Status updates (sent/delivered/read) arrive here too, without `messages`.
      for (const message of change.value.messages ?? []) {
        const body =
          message.type === "text" && message.text
            ? await answer(message.text.body)
            : "Please send your question as a text message.";
        await reply(phoneNumberId, message, body);
      }
    }
  }
}

// TODO: call the FastAPI answer endpoint (via BACKEND_URL + BFF_SHARED_SECRET) once it exists.
async function answer(question: string) {
  return `Bhumi Vikas Sahayak received your question:\n\n"${question}"\n\nAnswers from the MP Bhumi Vikas Rules, 2012 are coming soon.`;
}

async function reply(phoneNumberId: string, to: IncomingMessage, body: string) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.from,
      context: { message_id: to.id },
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) console.error("whatsapp reply failed", res.status, await res.text());
}
