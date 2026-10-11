"use client";

/* Click to start recording, click again to stop. The clip is sent to /api/stt
   (Sarvam) and the transcript is handed back through onTranscript. */

import { useEffect, useRef, useState } from "react";

const MAX_RECORD_MS = 28_000; // Sarvam's REST endpoint accepts ~30 s
const MIN_RECORD_MS = 600; // shorter than this is a mis-click

// First type the browser supports wins: Chrome/Brave/Firefox record webm/ogg, Safari records mp4.
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

const ERROR_TEXT: Record<string, string> = {
  audio_too_short: "That was too short — hold the mic a little longer and speak.",
  audio_too_long: "That recording was too long. Keep it under 30 seconds.",
  stt_busy: "Voice service is busy. Please try again in a moment.",
  stt_not_configured: "Voice input isn't set up on this server.",
  unauthorized: "Your session expired. Please log in again.",
  backend_unreachable: "Can't reach the server. Check your connection and try again.",
};

type Props = {
  onTranscript: (text: string) => void;
  disabled?: boolean;
};

export default function MicButton({ onTranscript, disabled = false }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "busy">("idle");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const startedAt = useRef(0);
  const mounted = useRef(true);

  function clearTimers() {
    timers.current.forEach((t) => clearInterval(t));
    timers.current = [];
  }

  function release() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  // Never leave the microphone on if the user navigates away mid-recording.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimers();
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      release();
    };
  }, []);

  // The message clears itself so it never lingers over the input.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 6000);
    return () => clearTimeout(t);
  }, [error]);

  async function transcribe(blob: Blob, mimeType: string) {
    setState("busy");
    try {
      const res = await fetch("/api/stt", {
        method: "POST",
        headers: { "content-type": mimeType.split(";")[0] || "audio/webm" },
        body: blob,
      });
      const data = await res.json().catch(() => null);
      if (!mounted.current) return;
      if (!res.ok) {
        setError(ERROR_TEXT[data?.code] ?? "Voice input failed. Please try again or type your question.");
        return;
      }
      if (data?.transcript) onTranscript(data.transcript);
      else setError("I couldn't hear any speech. Please speak closer to the mic and try again.");
    } catch {
      if (mounted.current) setError("Can't reach the server. Check your connection and try again.");
    } finally {
      if (mounted.current) setState("idle");
    }
  }

  async function start() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice input isn't supported in this browser. Please type your question.");
      return;
    }
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as DOMException).name;
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access is blocked. Allow it in your browser's site settings, then try again."
          : name === "NotFoundError"
            ? "No microphone found. Connect one and try again."
            : "The microphone is unavailable (another app may be using it).",
      );
      return;
    }
    stream.current = media;

    const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      clearTimers();
      release();
      const tooShort = Date.now() - startedAt.current < MIN_RECORD_MS;
      if (tooShort || chunks.length === 0) {
        setState("idle");
        setError(ERROR_TEXT.audio_too_short);
        return;
      }
      transcribe(new Blob(chunks, { type: rec.mimeType }), rec.mimeType);
    };
    rec.onerror = () => {
      clearTimers();
      release();
      setState("idle");
      setError("Recording failed. Please try again.");
    };

    recorder.current = rec;
    startedAt.current = Date.now();
    setSeconds(0);
    rec.start();
    setState("recording");
    timers.current.push(setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 250));
    timers.current.push(setInterval(() => Date.now() - startedAt.current >= MAX_RECORD_MS && stop(), 250));
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  const recording = state === "recording";
  const label = recording ? "Stop recording" : state === "busy" ? "Transcribing your voice" : "Speak your question";
  return (
    <div className="relative">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={disabled || state === "busy"}
        aria-label={label}
        title={label}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#F2E9D0]/30 text-[#F2E9D0] transition-colors hover:bg-[#F2E9D0]/10 focus:outline-none focus:ring-2 focus:ring-[#F2E9D0]/50 disabled:opacity-40 ${
          recording ? "animate-pulse border-red-400 bg-red-600 hover:bg-red-600" : ""
        }`}
      >
        {state === "busy" ? (
          <svg className="animate-spin" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : recording ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="2" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
          </svg>
        )}
      </button>
      {/* Screen readers hear status changes; sighted users see the tooltip. */}
      <div role="status" aria-live="polite" className="absolute bottom-12 right-0 z-30 w-max max-w-[min(20rem,80vw)]">
        {recording && (
          <span className="block rounded-lg bg-red-700 px-3 py-1.5 text-xs text-white shadow-lg">
            Recording… {seconds}s — tap to stop
          </span>
        )}
        {state === "busy" && (
          <span className="block rounded-lg bg-black/80 px-3 py-1.5 text-xs text-[#F2E9D0] shadow-lg">Transcribing…</span>
        )}
        {error && (
          <span className="block rounded-lg bg-black/85 px-3 py-1.5 text-xs leading-snug text-[#F2E9D0] shadow-lg">{error}</span>
        )}
      </div>
    </div>
  );
}
