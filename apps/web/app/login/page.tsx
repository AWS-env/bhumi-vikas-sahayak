import Link from "next/link";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 dark:bg-black">
      <LoginForm />
      <Link href="/" className="text-sm text-zinc-500 underline">
        ← Home
      </Link>
    </main>
  );
}
