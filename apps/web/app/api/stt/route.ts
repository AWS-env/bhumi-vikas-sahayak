import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// BFF for speech-to-text. The generic /api/py proxy reads bodies as text, which
// would corrupt audio, so audio gets its own route that forwards raw bytes.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const upstream = await fetch(`${process.env.BACKEND_URL}/stt`, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") ?? "audio/webm",
      "x-bff-secret": process.env.BFF_SHARED_SECRET!,
      "x-user-id": user.id,
    },
    body: await request.arrayBuffer(),
    cache: "no-store",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
