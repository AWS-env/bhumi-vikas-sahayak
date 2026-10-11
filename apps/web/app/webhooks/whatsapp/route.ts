import { createHmac, timingSafeEqual } from "node:crypto";
import { after, type NextRequest } from "next/server";

// WhatsApp Cloud API webhook. Lives outside /api so proxy.ts lets Meta through
// without a Supabase session; requests are authenticated by Meta's signature.

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0";
const WHATSAPP_MAX_CHARS = 4096;

// The reply is sent in after(); search + two model calls can take a while on a cold API.
export const maxDuration = 60;

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

type ChatReply = { reply: string; sources: { rule_id: string; title: string; page: number }[] };

async function answer(question: string) {
  let data: ChatReply;
  try {
    const res = await fetch(`${process.env.BACKEND_URL}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bff-secret": process.env.BFF_SHARED_SECRET!,
      },
      body: JSON.stringify({ messages: [{ role: "user", text: question.slice(0, 4000) }] }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`chat ${res.status}`);
    data = (await res.json()) as ChatReply;
  } catch (err) {
    console.error("whatsapp answer failed", err);
    return "Sorry, the rulebook service is not reachable right now. Please try again in a minute.";
  }

  // WhatsApp bold is *x*, not Markdown's **x**.
  let text = data.reply.replace(/\*\*(.+?)\*\*/g, "*$1*");
  // List only the rules the answer cites (first page of each); search also returns weaker hits.
  const firstPerRule = data.sources.filter(
    (s, i) => data.sources.findIndex((t) => t.rule_id === s.rule_id) === i,
  );
  const cited = firstPerRule.filter((s) =>
    new RegExp(`(Rule|नियम)\\s*${s.rule_id.replace(/[-]/g, "\\-")}(?![0-9])`, "i").test(text),
  );
  const rules = cited.length ? cited : firstPerRule.slice(0, 1);
  if (rules.length) {
    text += `\n\n_Sources:_ ${rules.map((s) => `Rule ${s.rule_id} (p. ${s.page})`).join(", ")}`;
  }
  return text.length > WHATSAPP_MAX_CHARS ? `${text.slice(0, WHATSAPP_MAX_CHARS - 1)}…` : text;
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
