import Link from "next/link";
import LoginForm from "./login-form";
import "./login.css";

export default function LoginPage() {
  return (
    <main className="login-page">
      <div className="login-shell">
        <LoginForm />
        <Link href="/" className="login-home">← Home</Link>
      </div>
    </main>
  );
}
