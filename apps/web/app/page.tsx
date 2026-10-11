import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col items-center gap-6 px-8 py-32 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Bhumi Vikas Sahayak</h1>
        <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Ask the Bhopal building rulebook (MP Bhumi Vikas Rules, 2012) in English or Hindi.
        </p>
        <Link
          href="/chat"
          className="flex h-12 items-center justify-center rounded-full bg-black px-6 font-medium text-white dark:bg-white dark:text-black"
        >
          Sign in to ask a question
        </Link>
      </main>
    </div>
  );
}
