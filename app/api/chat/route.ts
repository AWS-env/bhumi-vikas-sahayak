import { NextRequest, NextResponse } from "next/server";

interface ChatMessage {
  role: "user" | "model";
  text: string;
}

const GEMINI_API_KEY = (
  process.env.GEMINI_API_KEY ??
  process.env.GOOGLE_API_KEY ??
  ""
).trim();
const GEMINI_MODEL = (process.env.GEMINI_PRIMARY_MODEL ?? "gemini-2.5-flash").trim();

const SYSTEM_PROMPT = `You are Bhumi Vikas Sahayak, a helpful assistant for the MP Bhumi Vikas Rules, 2012 (Bhopal building rulebook). Answer citizen questions about building permissions, setbacks, FAR, ground coverage, and procedures in English or Hindi — matching the user's language. Keep answers short (under 4 sentences) unless asked for detail. If a question is off-topic, politely steer back to building rules.`;

/**
 * POST /api/chat
 * Body: { messages: [{ role: "user" | "model", text: string }] }
 * Returns: { reply: string }
 * Uses Gemini when GEMINI_API_KEY is set; otherwise returns a local echo
 * so the /chat page works with zero configuration.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const messages = body?.messages as ChatMessage[] | undefined;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");

  if (!GEMINI_API_KEY) {
    return NextResponse.json({
      reply: lastUser
        ? `I received: **${truncate(lastUser.text, 140)}**\n\nThe rulebook assistant backend isn't connected yet (set GEMINI_API_KEY to enable live answers). Ask me about setbacks, FAR, ground coverage, or building permission steps, and I'll answer once wired up.`
        : "Namaste! Ask me about the Bhumi Vikas Rules.",
    });
  }

  try {
    const contents = [
      { role: "user" as const, parts: [{ text: SYSTEM_PROMPT }] },
      {
        role: "model" as const,
        parts: [{ text: "Understood. I answer Bhumi Vikas Rules questions concisely." }],
      },
      ...messages.map((m) => ({
        role: (m.role === "user" ? "user" : "model") as "user" | "model",
        parts: [{ text: m.text }],
      })),
    ];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        }),
      }
    );

    const data = await geminiRes.json().catch(() => null);
    if (!geminiRes.ok) {
      return NextResponse.json(
        { error: data?.error?.message ?? "Gemini request failed" },
        { status: 502 }
      );
    }

    const reply: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "I couldn't generate an answer. Please try again.";
    return NextResponse.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
