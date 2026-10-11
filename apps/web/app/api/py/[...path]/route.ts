import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// BFF: the browser only talks to Next.js. After checking the session, we call
// FastAPI server-side with a private secret that never reaches the browser.
async function forward(request: NextRequest, ctx: RouteContext<"/api/py/[...path]">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { path } = await ctx.params;
  const url = `${process.env.BACKEND_URL}/${path.join("/")}${request.nextUrl.search}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const upstream = await fetch(url, {
    method: request.method,
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      "x-bff-secret": process.env.BFF_SHARED_SECRET!,
      "x-user-id": user.id,
    },
    body: hasBody ? await request.text() : undefined,
    cache: "no-store",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
