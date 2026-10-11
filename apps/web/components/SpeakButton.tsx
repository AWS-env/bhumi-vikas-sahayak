"use client";

/* Reads a bot answer aloud. The text goes to /api/tts (Sarvam), which returns
   one or more base64 WAV clips that are played back to back. Click again to stop. */

import { useEffect, useRef, useState } from "react";

type State = "idle" | "loading" | "playing";

const ERRORS: Record<string, string> = {
  tts_not_configured: "Voice playback isn't set up on this server.",
  tts_busy: "Voice service is busy. Please try again in a moment.",
  tts_unreachable: "Couldn't reach the voice service.",
  backend_unreachable: "Couldn't reach the server.",
  unauthorized: "Please sign in again.",
};

export default function SpeakButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const runRef = useRef(0); // bumped on stop/unmount so a late response doesn't start playing

  function stop() {
    runRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    setState("idle");
  }

  useEffect(() => () => {
    runRef.current += 1;
    audioRef.current?.pause();
  }, []);

  async function speak() {
    if (state !== "idle") return stop();
    const run = ++runRef.current;
    setError("");
    setState("loading");
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.audios)) {
        throw new Error(ERRORS[data?.code] ?? "Couldn't read this aloud. Please try again.");
      }
      for (const b64 of data.audios as string[]) {
        if (run !== runRef.current) return;
        const audio = new Audio(`data:audio/wav;base64,${b64}`);
        audioRef.current = audio;
        setState("playing");
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("Couldn't play the audio."));
          audio.play().catch(reject);
        });
      }
      if (run === runRef.current) setState("idle");
    } catch (err) {
      if (run !== runRef.current) return;
      setError(err instanceof Error ? err.message : "Couldn't read this aloud.");
      setState("idle");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={speak}
        aria-label={state === "idle" ? label : "Stop"}
        className="rounded-full border border-[#F2E9D0]/40 px-3 py-1 text-xs font-medium hover:bg-[#F2E9D0]/10"
      >
        {state === "idle" ? `🔊 ${label}` : state === "loading" ? "…" : "⏹"}
      </button>
      {error && <span className="text-xs text-amber-200">{error}</span>}
    </span>
  );
}
