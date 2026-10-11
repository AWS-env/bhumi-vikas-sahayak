import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// BFF for speech-to-text. The generic /api/py proxy reads bodies as text, which
// would corrupt audio, so audio gets its own route that forwards raw bytes.
// Errors come back as { code } so the browser can show a specific message.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ code: "unauthorized" }, { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(`${process.env.BACKEND_URL}/stt`, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") ?? "audio/webm",
        "x-bff-secret": process.env.BFF_SHARED_SECRET!,
        "x-user-id": user.id,
      },
      body: await request.arrayBuffer(),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return Response.json({ code: "backend_unreachable" }, { status: 502 });
  }

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return Response.json({ code: data?.detail ?? "stt_failed" }, { status: upstream.status });
  }
  return Response.json(data);
}
