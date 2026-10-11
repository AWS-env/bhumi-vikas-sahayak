"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2 } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types (reused from ps-crmdev1 ChatPanel)                           */
/* ------------------------------------------------------------------ */

interface DisplayMessage {
  id: string;
  role: "user" | "bot";
  text: string;
}

interface ChatHistoryItem {
  role: "user" | "model";
  text: string;
}

/* Palette matched to the reference etching — deep blueprint blue + ivory */
const C = {
  panel: "bg-[#053581] paper-grain",
  botBubble: "bg-[#14438A] text-[#F2E9D0] border border-[#F2E9D0]/20",
  userBubble: "bg-[#F2E9D0] text-[#0A3982]",
  inputShell: "border-[#F2E9D0]/25 bg-[#14438A]",
  inputField: "bg-transparent text-[#F2E9D0] placeholder:text-[#F2E9D0]/50",
  sendBtn: "bg-[#F2E9D0] text-[#0A3982] hover:bg-white",
  muted: "text-[#F2E9D0]/60",
  faintLine: "border-[#F2E9D0]/15",
} as const;

/* ------------------------------------------------------------------ */
/*  Component — prompting chat, structure reused from ChatPanel        */
/* ------------------------------------------------------------------ */

export default function ChatPanel() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const addBotMessage = useCallback(
    (text: string) => {
      setMessages((prev) => [...prev, { id: nextId(), role: "bot", text }]);
      historyRef.current.push({ role: "model", text });
      scrollToBottom();
    },
    [nextId, scrollToBottom]
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setMessages((prev) => [...prev, { id: nextId(), role: "user", text }]);
    historyRef.current.push({ role: "user", text });
    setInput("");
    setIsLoading(true);
    scrollToBottom();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historyRef.current }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Request failed");
      addBotMessage(data?.reply ?? "No reply received. Please try again.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      addBotMessage(`⚠️ ${msg}`);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [input, isLoading, nextId, scrollToBottom, addBotMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isInitialView = messages.length === 0;

  /* ---------- Messages content (same bubble pattern as ChatPanel) ---------- */
  const messagesContent = (
    <>
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === "user"
                ? `rounded-br-sm ${C.userBubble}`
                : `rounded-bl-sm ${C.botBubble}`
            }`}
          >
            {renderMarkdown(msg.text)}
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
          </div>
        </div>
      )}
    </>
  );

  /* ---------- Input bar (same pattern as ChatPanel inputBarContent) ---------- */
  const inputBarContent = (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          isInitialView ? "Ask about the Bhumi Vikas Rules…" : "Type your message…"
        }
        disabled={isLoading}
        className={`flex-1 rounded-full border border-transparent px-4 py-2.5 text-sm outline-none transition-all focus:border-[#F2E9D0]/40 ${C.inputField}`}
      />
      <button
        onClick={handleSend}
        disabled={isLoading || !input.trim()}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all hover:shadow-md disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#F2E9D0]/50 ${C.sendBtn}`}
        aria-label="Send message"
      >
        {isLoading ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
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

        {/* Centered greeting (mirrors ChatPanel greeting → active transition) */}
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
/*  Very lightweight Markdown renderer (bold only — reused)            */
/* ------------------------------------------------------------------ */

function renderMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
