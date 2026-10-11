import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import ChatPanel from "@/components/ChatPanel";

async function ChatShell() {
  await connection(); // session check must run per request, never at prerender
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
        <h1 className="text-lg font-semibold">Bhumi Vikas Sahayak</h1>
        <div className="flex items-center gap-4 text-sm">
          <span data-testid="user-email" className="text-zinc-600 dark:text-zinc-400">
            {user.email}
          </span>
          <form action={signOut}>
            <button type="submit" className="rounded-md border border-black/[.15] px-3 py-1 dark:border-white/[.25]">
              Logout
            </button>
          </form>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        <ChatPanel />
      </main>
    </>
  );
}

export default function ChatPage() {
  return (
    <div className="flex h-dvh flex-col">
      <Suspense fallback={<p className="p-6">Loading…</p>}>
        <ChatShell />
      </Suspense>
    </div>
  );
}
