"use client";

import { useActionState, useState } from "react";
import { demoLogin, signIn, signUp, type AuthState } from "./actions";

type Lang = "en" | "hi";
type Mode = "signin" | "signup";

const t = {
  en: {
    title: "Staff login",
    sub: "Bhumi Vikas Sahayak",
    email: "Email",
    password: "Password",
    signin: "Sign in",
    signup: "Create account",
    toSignup: "New here? Create an account",
    toSignin: "Already have an account? Sign in",
    hint: "At least 8 characters",
    demo: "Try demo (no sign-in needed)",
    errors: {
      demo_failed: "Demo login is unavailable right now. Sign in with your account.",
      missing: "Enter email and password.",
      invalid: "Wrong email or password.",
      short: "Password must be at least 8 characters.",
      exists: "This email already has an account. Sign in instead.",
      failed: "Could not create the account. Try again.",
      confirm_on:
        "Account created, but email confirmation is still switched on in Supabase. Ask the admin to turn it off.",
    },
  },
  hi: {
    title: "स्टाफ लॉगिन",
    sub: "भूमि विकास सहायक",
    email: "ईमेल",
    password: "पासवर्ड",
    signin: "साइन इन करें",
    signup: "खाता बनाएँ",
    toSignup: "नए हैं? खाता बनाएँ",
    toSignin: "पहले से खाता है? साइन इन करें",
    hint: "कम से कम 8 अक्षर",
    demo: "डेमो आज़माएँ (साइन इन ज़रूरी नहीं)",
    errors: {
      demo_failed: "डेमो लॉगिन अभी उपलब्ध नहीं है। अपने खाते से साइन इन करें।",
      missing: "ईमेल और पासवर्ड भरें।",
      invalid: "ईमेल या पासवर्ड गलत है।",
      short: "पासवर्ड कम से कम 8 अक्षर का होना चाहिए।",
      exists: "इस ईमेल का खाता पहले से है। साइन इन करें।",
      failed: "खाता नहीं बन सका। फिर कोशिश करें।",
      confirm_on:
        "खाता बन गया, लेकिन Supabase में ईमेल पुष्टि अभी चालू है। एडमिन से बंद करवाएँ।",
    },
  },
} as const;

export default function LoginForm() {
  const [lang, setLang] = useState<Lang>("en");
  const [mode, setMode] = useState<Mode>("signin");
  const [state, action, pending] = useActionState<AuthState, FormData>(
    mode === "signin" ? signIn : signUp,
    null,
  );
  const [demoState, demoAction, demoPending] = useActionState<AuthState, FormData>(
    async () => demoLogin(),
    null,
  );
  const s = t[lang];
  const error = state?.error ?? demoState?.error;
  const errorText = error ? s.errors[error as keyof typeof s.errors] : null;

  return (
    <div className="w-full max-w-sm rounded-xl border border-black/[.08] bg-white p-8 shadow-sm dark:border-white/[.145] dark:bg-zinc-900">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-sm text-zinc-500">{s.sub}</p>
          <h1 className="text-2xl font-semibold">{s.title}</h1>
        </div>
        <div className="flex overflow-hidden rounded-md border border-black/[.12] text-sm dark:border-white/[.2]">
          {(["en", "hi"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`px-3 py-1 ${lang === l ? "bg-black text-white dark:bg-white dark:text-black" : ""}`}
            >
              {l === "en" ? "EN" : "हिं"}
            </button>
          ))}
        </div>
      </div>

      <form action={action} key={mode} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          {s.email}
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-md border border-black/[.2] bg-transparent px-3 py-2 dark:border-white/[.25]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {s.password}
          <input
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            className="rounded-md border border-black/[.2] bg-transparent px-3 py-2 dark:border-white/[.25]"
          />
          {mode === "signup" && <span className="text-xs text-zinc-500">{s.hint}</span>}
        </label>

        {errorText && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {errorText}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || demoPending}
          className="h-11 rounded-md bg-black font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
        >
          {mode === "signin" ? s.signin : s.signup}
        </button>
      </form>

      <form action={demoAction} className="mt-3">
        <button
          type="submit"
          disabled={pending || demoPending}
          data-testid="demo-login"
          className="h-11 w-full rounded-md border border-black/[.2] font-medium disabled:opacity-60 dark:border-white/[.25]"
        >
          {s.demo}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="mt-4 text-sm text-zinc-600 underline dark:text-zinc-400"
      >
        {mode === "signin" ? s.toSignup : s.toSignin}
      </button>
    </div>
  );
}
