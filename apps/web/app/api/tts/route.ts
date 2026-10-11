import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// BFF for text-to-speech. Errors come back as { code } so the browser can show a specific message.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ code: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (typeof body?.text !== "string" || !body.text.trim()) {
    return Response.json({ code: "tts_empty" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${process.env.BACKEND_URL}/speak`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bff-secret": process.env.BFF_SHARED_SECRET!,
        "x-user-id": user.id,
      },
      body: JSON.stringify({ text: body.text }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return Response.json({ code: "backend_unreachable" }, { status: 502 });
  }

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return Response.json({ code: data?.detail ?? "tts_failed" }, { status: upstream.status });
  }
  return Response.json(data);
}
