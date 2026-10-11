"use client";

import { useActionState, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
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
    signingIn: "Signing in…",
    creating: "Creating account…",
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
    signingIn: "साइन इन हो रहा है…",
    creating: "खाता बन रहा है…",
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
  const card = useRef<HTMLElement>(null);
  const formPanel = useRef<HTMLDivElement>(null);
  const artPanel = useRef<HTMLDivElement>(null);
  const artImage = useRef<HTMLDivElement>(null);
  const formContent = useRef<HTMLDivElement>(null);
  const modeSwitch = useRef<HTMLButtonElement>(null);
  const animationContext = useRef<gsap.Context | null>(null);
  const panelSwap = useRef<gsap.core.Timeline | null>(null);
  const currentMode = useRef<Mode>("signin");
  const [lang, setLang] = useState<Lang>("en");
  const [mode, setMode] = useState<Mode>("signin");
  const [switching, setSwitching] = useState(false);
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

  useLayoutEffect(() => {
    const motion = gsap.matchMedia();
    motion.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(card.current, {
        opacity: 0,
        y: 10,
        duration: 0.8,
        ease: "sine.out",
        clearProps: "opacity,transform",
      });
    }, card);
    return () => motion.revert();
  }, []);

  useLayoutEffect(() => {
    const context = gsap.context(() => {}, card);
    animationContext.current = context;
    const desktop = window.matchMedia("(min-width: 761px)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const alignPanels = () => context.add(() => {
      // Finish a running switch before a breakpoint or motion preference changes.
      panelSwap.current?.progress(1);
      const swapped = desktop.matches && currentMode.current === "signup";
      gsap.set(formPanel.current, { xPercent: swapped ? (52.75 / 47.25) * 100 : 0 });
      gsap.set(artPanel.current, { xPercent: swapped ? -(47.25 / 52.75) * 100 : 0 });
    });
    desktop.addEventListener("change", alignPanels);
    reduced.addEventListener("change", alignPanels);
    return () => {
      desktop.removeEventListener("change", alignPanels);
      reduced.removeEventListener("change", alignPanels);
      context.revert();
      animationContext.current = null;
      panelSwap.current = null;
    };
  }, []);

  function switchMode() {
    if (pending || demoPending || switching || !animationContext.current) return;
    const nextMode = mode === "signin" ? "signup" : "signin";
    currentMode.current = nextMode;
    const desktop = window.matchMedia("(min-width: 761px)").matches;
    const swapped = desktop && nextMode === "signup";
    const formX = swapped ? (52.75 / 47.25) * 100 : 0;
    const artX = swapped ? -(47.25 / 52.75) * 100 : 0;

    animationContext.current.add(() => {
      panelSwap.current?.kill();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(formPanel.current, { xPercent: formX });
        gsap.set(artPanel.current, { xPercent: artX });
        setMode(nextMode);
        return;
      }

      setSwitching(true);
      const direction = nextMode === "signup" ? 1 : -1;
      // The image acts as a curtain; change the form only while it is invisible.
      const swap = gsap.timeline({
        onComplete: () => {
          setSwitching(false);
          requestAnimationFrame(() => modeSwitch.current?.focus({ preventScroll: true }));
        },
      });
      swap.to(formContent.current, { opacity: 0, y: -6, duration: 0.16, ease: "power1.in" }, 0)
        .call(() => setMode(nextMode), [], 0.18);

      if (desktop) {
        swap.to(formPanel.current, { xPercent: formX, duration: 0.96, ease: "power3.inOut" }, 0.06)
          .to(artPanel.current, { xPercent: artX, duration: 0.96, ease: "power3.inOut" }, 0.06)
          .to(artImage.current, { xPercent: direction * 1.2, scale: 1.035, duration: 0.46, ease: "sine.inOut" }, 0.06)
          .to(artImage.current, { xPercent: 0, scale: 1, duration: 0.56, ease: "sine.out" }, 0.52);
      }

      swap.set(formContent.current, { y: 8 }, desktop ? 0.68 : 0.2)
        .to(formContent.current, { opacity: 1, y: 0, duration: desktop ? 0.4 : 0.26, ease: "power2.out", clearProps: "opacity,transform" }, desktop ? 0.68 : 0.2);
      panelSwap.current = swap;
    });
  }

  return (
    <section ref={card} className="login-card" aria-labelledby="login-title" data-switching={switching} aria-busy={switching}>
      <div ref={formPanel} className="login-form-panel" lang={lang}>
      <div ref={formContent} className="login-form-content" inert={switching}>
      <div className="login-form-header">
        <div>
          <p className="login-subtitle">{s.sub}</p>
          <h1 id="login-title" className="login-title">{mode === "signin" ? s.title : s.signup}</h1>
        </div>
        <div className="login-language" role="group" aria-label="Language">
          {(["en", "hi"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              aria-label={l === "en" ? "English" : "हिन्दी"}
            >
              {l === "en" ? "EN" : "हिं"}
            </button>
          ))}
        </div>
      </div>

      <form action={action} key={mode} className="login-fields" aria-busy={pending}>
        <label className="login-field">
          {s.email}
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="login-input"
          />
        </label>
        <label className="login-field">
          {s.password}
          <input
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            aria-describedby={mode === "signup" ? "password-hint" : undefined}
            className="login-input"
          />
          {mode === "signup" && <span id="password-hint" className="login-hint">{s.hint}</span>}
        </label>

        {errorText && (
          <p role="alert" className="login-error">
            {errorText}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || demoPending}
          className="login-submit"
        >
          {pending ? (mode === "signin" ? s.signingIn : s.creating) : (mode === "signin" ? s.signin : s.signup)}
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
        ref={modeSwitch}
        disabled={pending || demoPending || switching}
        onClick={switchMode}
        className="login-mode-switch"
      >
        {mode === "signin" ? s.toSignup : s.toSignin}
      </button>
      </div>
      </div>
      <div ref={artPanel} className="login-art" aria-hidden="true">
        <div ref={artImage} className="login-art-image" />
      </div>
    </section>
  );
}
