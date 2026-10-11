"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string } | null;

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { error: "missing" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "invalid" };
  redirect("/chat");
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { error: "missing" };
  if (password.length < 8) return { error: "short" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.code === "user_already_exists" ? "exists" : "failed" };
  // No session means Supabase "Confirm email" is still on in the dashboard.
  if (!data.session) return { error: "confirm_on" };
  redirect("/chat");
}

// One-click demo: signs into a shared demo account, creating it on first use
// (works because Supabase "Confirm email" is off).
export async function demoLogin(): Promise<AuthState> {
  const email = process.env.DEMO_EMAIL || "demo@bhumivikas.app";
  const password = process.env.DEMO_PASSWORD || "demo-bhumi-vikas-2025";

  const supabase = await createClient();
  const first = await supabase.auth.signInWithPassword({ email, password });
  if (!first.error) redirect("/chat");

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.session) return { error: "demo_failed" };
  redirect("/chat");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
