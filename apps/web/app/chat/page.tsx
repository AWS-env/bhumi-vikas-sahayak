import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

async function ChatShell() {
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
      <main className="flex flex-1 items-center justify-center p-8 text-zinc-500">
        Chat coming soon.
      </main>
    </>
  );
}

export default function ChatPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Suspense fallback={<p className="p-6">Loading…</p>}>
        <ChatShell />
      </Suspense>
    </div>
  );
}
