import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// Server tool for the ElevenLabs voice agent: the agent POSTs the caller's question here and
// speaks the answer. Lives outside /api so proxy.ts lets ElevenLabs through without a Supabase
// session; requests are authenticated by a shared secret header set on the tool.

export const maxDuration = 60;

type ChatReply = { reply: string; sources: { rule_id: string; title: string; page: number }[] };

export async function POST(request: NextRequest) {
  if (!hasToolSecret(request.headers.get("x-tool-secret"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }

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
    const data = (await res.json()) as ChatReply;
    const rules = [...new Set(data.sources.map((s) => s.rule_id))];
    // Plain text only; the agent reads this aloud.
    return Response.json({ answer: data.reply.replace(/[*_~`#>]/g, ""), rules });
  } catch (err) {
    console.error("elevenlabs tool failed", err);
    return Response.json({
      answer: "The rulebook service is not reachable right now. Ask the caller to try again in a minute.",
      rules: [],
    });
  }
}

function hasToolSecret(header: string | null) {
  const secret = process.env.ELEVENLABS_TOOL_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
