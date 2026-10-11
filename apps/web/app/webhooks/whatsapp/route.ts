import { createHmac, timingSafeEqual } from "node:crypto";
import { after, type NextRequest } from "next/server";

// WhatsApp Cloud API webhook. Lives outside /api so proxy.ts lets Meta through
// without a Supabase session; requests are authenticated by Meta's signature.

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0";
const WHATSAPP_MAX_CHARS = 4096;

// The reply is sent in after(); a voice note adds download + STT + TTS on top of search + two model calls.
export const maxDuration = 60;

type IncomingMessage = {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type: string; voice?: boolean };
};
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
        if (message.type === "text" && message.text) {
          await reply(phoneNumberId, message, (await answer(message.text.body)).text);
        } else if (message.type === "audio" && message.audio) {
          await handleVoice(phoneNumberId, message, message.audio);
        } else {
          await reply(phoneNumberId, message, "Please send your question as a text or voice message.");
        }
      }
    }
  }
}

// Voice note in -> transcript -> same answer as text, sent back as text (with sources) plus a voice note.
async function handleVoice(phoneNumberId: string, message: IncomingMessage, audio: { id: string; mime_type: string }) {
  let transcript: { transcript: string; language_code: string | null };
  try {
    const bytes = await downloadMedia(audio.id);
    const res = await fetch(`${process.env.BACKEND_URL}/stt`, {
      method: "POST",
      headers: { "content-type": audio.mime_type, "x-bff-secret": process.env.BFF_SHARED_SECRET! },
      body: bytes,
      cache: "no-store",
    });
    if (res.status === 413) {
      await reply(phoneNumberId, message, "That voice note is too long. Please keep it under 30 seconds.");
      return;
    }
    if (!res.ok) throw new Error(`stt ${res.status}`);
    transcript = await res.json();
  } catch (err) {
    console.error("whatsapp voice transcription failed", err);
    await reply(phoneNumberId, message, "Sorry, I could not understand that voice note. Please try again or type your question.");
    return;
  }

  if (!transcript.transcript.trim()) {
    await reply(phoneNumberId, message, "I could not hear a question in that voice note. Please try again.");
    return;
  }

  const result = await answer(transcript.transcript);
  await reply(phoneNumberId, message, `🎤 _${transcript.transcript}_\n\n${result.text}`);
  if (result.ok) await replyWithVoice(phoneNumberId, message, result.spoken, transcript.language_code);
}

// Media IDs resolve to a short-lived URL that also needs the access token.
async function downloadMedia(mediaId: string) {
  const auth = { authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` };
  const meta = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, { headers: auth });
  if (!meta.ok) throw new Error(`media lookup ${meta.status}`);
  const { url } = (await meta.json()) as { url: string };
  const file = await fetch(url, { headers: auth });
  if (!file.ok) throw new Error(`media download ${file.status}`);
  return file.arrayBuffer();
}

async function replyWithVoice(phoneNumberId: string, to: IncomingMessage, text: string, language: string | null) {
  try {
    const tts = await fetch(`${process.env.BACKEND_URL}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bff-secret": process.env.BFF_SHARED_SECRET! },
      body: JSON.stringify({ text, language_code: language }),
      cache: "no-store",
    });
    if (!tts.ok) throw new Error(`tts ${tts.status}`);

    // Voice notes must be Ogg/Opus mono, which is what /tts returns.
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "audio/ogg");
    form.append("file", new Blob([await tts.arrayBuffer()], { type: "audio/ogg" }), "reply.ogg");
    const upload = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      body: form,
    });
    if (!upload.ok) throw new Error(`media upload ${upload.status} ${await upload.text()}`);
    const { id } = (await upload.json()) as { id: string };

    await send(phoneNumberId, { to: to.from, context: { message_id: to.id }, type: "audio", audio: { id, voice: true } });
  } catch (err) {
    // The text answer has already gone out, so a failed voice note is not fatal.
    console.error("whatsapp voice reply failed", err);
  }
}

type ChatReply = { reply: string; sources: { rule_id: string; title: string; page: number }[] };

// `text` is the WhatsApp message (with sources); `spoken` is just the answer, for TTS.
async function answer(question: string): Promise<{ ok: boolean; text: string; spoken: string }> {
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
    const text = "Sorry, the rulebook service is not reachable right now. Please try again in a minute.";
    return { ok: false, text, spoken: text };
  }

  // WhatsApp bold is *x*, not Markdown's **x**.
  const spoken = data.reply;
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
  if (text.length > WHATSAPP_MAX_CHARS) text = `${text.slice(0, WHATSAPP_MAX_CHARS - 1)}…`;
  return { ok: true, text, spoken };
}

async function reply(phoneNumberId: string, to: IncomingMessage, body: string) {
  await send(phoneNumberId, { to: to.from, context: { message_id: to.id }, type: "text", text: { body } });
}

async function send(phoneNumberId: string, message: Record<string, unknown>) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...message }),
  });
  if (!res.ok) console.error("whatsapp send failed", res.status, await res.text());
}
