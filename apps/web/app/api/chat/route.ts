import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// BFF for the chat screen: checks the Supabase session, then calls FastAPI /chat.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(`${process.env.BACKEND_URL}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bff-secret": process.env.BFF_SHARED_SECRET!,
        "x-user-id": user.id,
      },
      body: await request.text(),
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: "The answer service is not reachable." }, { status: 502 });
  }

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return Response.json({ error: "Could not get an answer. Please try again." }, { status: upstream.status });
  }
  return Response.json(data);
}
