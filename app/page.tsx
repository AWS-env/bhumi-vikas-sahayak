"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [message, setMessage] = useState("Loading...");
  const [status, setStatus] = useState("Loading...");

  useEffect(() => {
    fetch("/api/py/helloFastApi")
      .then((res) => res.json())
      .then((data) => setMessage(data.message))
      .catch(() => setMessage("Failed to reach FastAPI"));

    fetch("/api/py/health")
      .then((res) => res.json())
      .then((data) => setStatus(data.status))
      .catch(() => setStatus("unreachable"));
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col items-center gap-6 px-16 py-32 text-center">
        <h1 className="text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
          Bhumi Vikas Sahayak
        </h1>
        <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Next.js frontend + FastAPI backend on Vercel.
        </p>
        <div className="w-full rounded-lg border border-black/[.08] p-6 text-left font-mono text-sm dark:border-white/[.145]">
          <p>
            <span className="text-zinc-500">GET /api/py/helloFastApi → </span>
            {message}
          </p>
          <p className="mt-2">
            <span className="text-zinc-500">GET /api/py/health → </span>
            {status}
          </p>
        </div>
        <div className="flex gap-4 text-base font-medium">
          <a
            className="flex h-12 items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
          >
            FastAPI Docs
          </a>
          <a
            className="flex h-12 items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            href="https://nextjs.org/docs"
            target="_blank"
            rel="noopener noreferrer"
          >
            Next.js Docs
          </a>
        </div>
      </main>
    </div>
  );
}
