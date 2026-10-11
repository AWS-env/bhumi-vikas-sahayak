"use client";

/* Push-to-record mic: click to start, click again to stop. The clip is sent to
   /api/stt (Sarvam) and the transcript is handed back through onTranscript. */

import { useRef, useState } from "react";

const MAX_RECORD_MS = 28_000; // Sarvam's REST endpoint accepts ~30 s

type Props = { onTranscript: (text: string) => void; className?: string };

export default function MicButton({ onTranscript, className = "" }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "busy">("idle");
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function start() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearTimeout(timer.current);
        setState("busy");
        try {
          const blob = new Blob(chunks, { type: rec.mimeType });
          const res = await fetch("/api/stt", {
            method: "POST",
            headers: { "content-type": rec.mimeType || "audio/webm" },
            body: blob,
          });
          if (!res.ok) throw new Error();
          const { transcript } = await res.json();
          if (transcript) onTranscript(transcript);
          else setError("Couldn't hear anything");
        } catch {
          setError("Voice input failed");
        } finally {
          setState("idle");
        }
      };
      rec.start();
      recorder.current = rec;
      timer.current = setTimeout(stop, MAX_RECORD_MS);
      setState("recording");
    } catch {
      setError("Microphone unavailable");
    }
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  const recording = state === "recording";
  return (
    <div className="relative">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={state === "busy"}
        aria-label={recording ? "Stop recording" : "Speak your question"}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#F2E9D0]/30 text-[#F2E9D0] disabled:opacity-50 ${
          recording ? "animate-pulse bg-red-600" : ""
        } ${className}`}
      >
        {state === "busy" ? (
          <span className="text-xs">…</span>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
          </svg>
        )}
      </button>
      {error && (
        <span className="absolute bottom-12 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-2 py-1 text-xs text-[#F2E9D0]">
          {error}
        </span>
      )}
    </div>
  );
}
