"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MicButton from "./MicButton";

const MAX_INPUT_HEIGHT_PX = 160; // about 6 lines, then the box scrolls
const MAX_INPUT_CHARS = 2000;

/* ------------------------------------------------------------------ */
/*  Types (reused from ChatPanel)                                      */
/* ------------------------------------------------------------------ */

interface Source {
  rule_id: string;
  title: string;
  page: number;
}

interface DisplayMessage {
  id: string;
  role: "user" | "bot";
  text: string;
  sources?: Source[];
  language?: "english" | "hindi" | "hinglish";
  amendmentWarning?: boolean;
  /** Set on a failed turn: the question that can be sent again. */
  retryText?: string;
}

const NOTE = {
  en: {
    basis: "Based on the MP Bhumi Vikas Rules, 2012, consolidated to 6 March 2025. Amendments after that date are not included. Not legal advice — the clerk decides.",
    amendment:
      "The rules for plots up to 500 sq m were amended on 28 August 2026 (Rule 2(5)(c)). That amendment is NOT included here — please verify the current position.",
    sources: "Sources",
    rule: "Rule",
    page: "p.",
    retry: "Try again",
  },
  hi: {
    basis: "यह उत्तर म.प्र. भूमि विकास नियम, 2012 (6 मार्च 2025 तक समेकित) पर आधारित है। इसके बाद के संशोधन शामिल नहीं हैं। यह कानूनी सलाह नहीं है — निर्णय क्लर्क का है।",
    amendment:
      "500 वर्ग मीटर तक के भूखंडों के नियम 28 अगस्त 2026 को संशोधित हुए (नियम 2(5)(c))। वह संशोधन यहाँ शामिल नहीं है — कृपया वर्तमान स्थिति जाँचें।",
    sources: "स्रोत",
    rule: "नियम",
    page: "पृ.",
    retry: "फिर कोशिश करें",
  },
} as const;

interface ChatHistoryItem {
  role: "user" | "model";
  text: string;
}

/* Palette matched to the reference etching — deep blueprint blue + ivory */
const C = {
  panel: "bg-[#053581] paper-grain",
  errorBubble: "bg-[#5B1A1A] text-[#F9E3E3] border border-red-300/40",
  botBubble: "bg-[#14438A] text-[#F2E9D0] border border-[#F2E9D0]/20",
  userBubble: "bg-[#F2E9D0] text-[#0A3982]",
  inputShell: "border-[#F2E9D0]/25 bg-[#14438A]",
  inputField: "bg-transparent text-[#F2E9D0] placeholder:text-[#F2E9D0]/50",
  sendBtn: "bg-[#F2E9D0] text-[#0A3982] hover:bg-white",
  muted: "text-[#F2E9D0]/60",
  faintLine: "border-[#F2E9D0]/15",
} as const;

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function LoaderIcon({ className }: { className?: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Component — prompting chat                                        */
/* ------------------------------------------------------------------ */

export default function ChatPanel() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<ChatHistoryItem[]>([]);
  const idRef = useRef(0);

  const nextId = useCallback(() => {
    idRef.current += 1;
    return `m${Date.now()}-${idRef.current}`;
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Grow the question box with its text (up to ~6 lines); shrink back after sending.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }, [input]);

  const send = useCallback(async (text: string) => {
    if (!text || isLoading) return;

    // Retrying replaces the failed turn (its question and error bubble) instead of duplicating it.
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      const base = last?.retryText ? prev.slice(0, -2) : prev;
      return [...base, { id: nextId(), role: "user", text }];
    });
    historyRef.current.push({ role: "user", text });
    setIsLoading(true);
    scrollToBottom();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historyRef.current }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          data?.error ??
            (res.status === 404
              ? "Chat backend API is not configured yet."
              : "Request failed")
        );
      }
      if (!data?.reply) throw new Error("No reply received. Please try again.");
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "bot",
          text: data.reply,
          sources: data.sources,
          language: data.language,
          amendmentWarning: data.amendment_warning,
        },
      ]);
      historyRef.current.push({ role: "model", text: data.reply });
    } catch (err) {
      // Errors are shown but never stored in the history sent to the model.
      historyRef.current.pop();
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) => [...prev, { id: nextId(), role: "bot", text: msg, retryText: text }]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [isLoading, nextId, scrollToBottom]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    send(text);
  }, [input, send]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    // Enter while composing Hindi (IME) confirms the word; it must not send.
    if (e.nativeEvent.isComposing) return;
    if (e.shiftKey) return; // Shift+Enter: the browser inserts a new line
    e.preventDefault();
    handleSend();
  };

  const isInitialView = messages.length === 0;

  /* ---------- Messages content ---------- */
  const messagesContent = (
    <>
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
              msg.role === "user"
                ? `whitespace-pre-wrap rounded-br-sm ${C.userBubble}`
                : `rounded-bl-sm ${msg.retryText ? C.errorBubble : C.botBubble}`
            }`}
          >
            {msg.role === "user" || msg.retryText ? (
              <span className="whitespace-pre-wrap">{msg.text}</span>
            ) : (
              <BotText msg={msg} />
            )}
            {msg.retryText && (
              <button
                type="button"
                onClick={() => send(msg.retryText!)}
                disabled={isLoading}
                className="mt-2 block rounded-full border border-[#F2E9D0]/40 px-3 py-1 text-xs font-medium hover:bg-[#F2E9D0]/10 disabled:opacity-40"
              >
                {NOTE.en.retry}
              </button>
            )}
          </div>
        </div>
      ))}
      {isLoading && (
        <div className="flex justify-start">
          <div
            className={`flex items-center gap-1 rounded-2xl rounded-bl-sm px-4 py-3 ${C.botBubble}`}
          >
            <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-[#F2E9D0]/70 [animation-delay:0ms]" />
            <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-[#F2E9D0]/70 [animation-delay:150ms]" />
            <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-[#F2E9D0]/70 [animation-delay:300ms]" />
            <span className="ml-2 text-xs text-[#F2E9D0]/70">Searching the rules…</span>
          </div>
        </div>
      )}
    </>
  );

  /* ---------- Input bar ---------- */
  const inputBarContent = (
    <div className="flex items-end gap-2">
      <textarea
        ref={inputRef}
        rows={1}
        maxLength={MAX_INPUT_CHARS}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          isInitialView
            ? "Ask about the Bhumi Vikas Rules…  (Shift+Enter for a new line)"
            : "Type your message…  (Shift+Enter for a new line)"
        }
        aria-label="Your question"
        disabled={isLoading}
        className={`flex-1 resize-none overflow-y-auto rounded-2xl border border-transparent px-4 py-2.5 text-sm leading-6 outline-none transition-colors focus:border-[#F2E9D0]/40 ${C.inputField}`}
      />
      <MicButton
        disabled={isLoading}
        onTranscript={(t) => setInput((prev) => (prev ? `${prev} ${t}` : t))}
      />
      <button
        onClick={handleSend}
        disabled={isLoading || !input.trim()}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all hover:shadow-md disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#F2E9D0]/50 ${C.sendBtn}`}
        aria-label="Send message"
      >
        {isLoading ? <LoaderIcon className="animate-spin" /> : <SendIcon />}
      </button>
    </div>
  );

  return (
    <div className={`flex h-full flex-col overflow-hidden ${C.panel}`}>
      <div className="flex h-full flex-col">
        {/* Top spacer for initial vertical centering */}
        <div
          className={`transition-[flex-grow] duration-700 ease-[cubic-bezier(0.25,1,0.5,1)] ${
            isInitialView ? "flex-grow-[1.5]" : "flex-grow-0"
          }`}
        />

        {/* Centered greeting */}
        <div
          className={`mx-auto flex w-full max-w-3xl shrink-0 origin-bottom transform flex-col items-center overflow-hidden px-4 transition-all duration-500 ease-in-out ${
            isInitialView
              ? "visible mb-8 max-h-[400px] scale-100 translate-y-0 gap-5 opacity-100"
              : "invisible mb-0 max-h-0 scale-95 -translate-y-8 gap-0 opacity-0"
          }`}
        >
          <h1 className="text-center text-3xl font-semibold tracking-tight text-[#F2E9D0] sm:text-4xl">
            Bhumi Vikas Sahayak
          </h1>
          <p className={`text-center text-sm ${C.muted}`}>
            Ask about the MP Bhumi Vikas Rules, 2012 — in English or Hindi.
          </p>
        </div>

        {/* Messages area */}
        <div
          ref={scrollRef}
          className={`min-h-0 w-full overflow-y-auto px-4 transition-all duration-700 ease-[cubic-bezier(0.25,1,0.5,1)] ${
            isInitialView ? "flex-[0_1_0%] py-0 opacity-0" : "flex-[1_1_0%] py-3 opacity-100"
          }`}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col space-y-3">
            <div className="min-h-0 flex-1" />
            {messagesContent}
          </div>
        </div>

        {/* Bottom input bar */}
        <div className="relative z-20 flex-shrink-0 px-4 pb-5 pt-2">
          <div
            className={`mx-auto max-w-3xl rounded-2xl border px-3 py-3 shadow-lg ${C.inputShell}`}
          >
            {inputBarContent}
          </div>
        </div>

        {/* Bottom spacer for initial vertical centering */}
        <div
          className={`transition-[flex-grow] duration-700 ease-[cubic-bezier(0.25,1,0.5,1)] ${
            isInitialView ? "flex-grow-[1]" : "flex-grow-0"
          }`}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bot answer: markdown (tables, bold, lists), sources and the notes   */
/* ------------------------------------------------------------------ */

const MD_COMPONENTS = {
  p: (props: React.ComponentProps<"p">) => <p className="my-1.5 first:mt-0 last:mb-0" {...props} />,
  ul: (props: React.ComponentProps<"ul">) => <ul className="my-1.5 list-disc space-y-1 pl-5" {...props} />,
  ol: (props: React.ComponentProps<"ol">) => <ol className="my-1.5 list-decimal space-y-1 pl-5" {...props} />,
  blockquote: (props: React.ComponentProps<"blockquote">) => (
    <blockquote className="my-2 border-l-2 border-[#F2E9D0]/40 pl-3 italic text-[#F2E9D0]/90" {...props} />
  ),
  table: (props: React.ComponentProps<"table">) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-[#F2E9D0]/20">
      <table className="w-full border-collapse text-left text-xs" {...props} />
    </div>
  ),
  th: (props: React.ComponentProps<"th">) => (
    <th className="border-b border-[#F2E9D0]/25 bg-[#F2E9D0]/10 px-2.5 py-1.5 font-semibold" {...props} />
  ),
  td: (props: React.ComponentProps<"td">) => (
    <td className="border-b border-[#F2E9D0]/10 px-2.5 py-1.5" {...props} />
  ),
  a: (props: React.ComponentProps<"a">) => <a className="underline" target="_blank" rel="noreferrer" {...props} />,
};

function BotText({ msg }: { msg: DisplayMessage }) {
  const t = msg.language === "hindi" ? NOTE.hi : NOTE.en;
  const sources = msg.sources ?? [];
  return (
    <>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {msg.text}
      </ReactMarkdown>
      {msg.amendmentWarning && (
        <p className="mt-2 rounded-lg border border-amber-300/50 bg-amber-300/10 px-3 py-2 text-xs leading-snug text-amber-100">
          ⚠ {t.amendment}
        </p>
      )}
      {sources.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-[#F2E9D0]/15 pt-2 text-xs">
          <span className="text-[#F2E9D0]/60">{t.sources}:</span>
          {sources.map((s) => (
            <span
              key={s.rule_id}
              title={s.title}
              className="rounded-full border border-[#F2E9D0]/30 px-2 py-0.5 text-[#F2E9D0]/90"
            >
              {t.rule} {s.rule_id} · {t.page}
              {s.page}
            </span>
          ))}
        </div>
      )}
      {sources.length > 0 && <p className="mt-2 text-[11px] leading-snug text-[#F2E9D0]/55">{t.basis}</p>}
    </>
  );
}
