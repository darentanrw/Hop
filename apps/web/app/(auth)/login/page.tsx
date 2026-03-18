import Link from "next/link";
import { LoginForm } from "../../../components/login-form";

export default function LoginPage() {
  return (
    <div className="auth-page">
      <div className="auth-header">
        <Link href="/" className="auth-back">
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Back
        </Link>
        <h1>Welcome to Hop</h1>
        <p style={{ marginTop: 8 }}>Sign in with your NUS email to get started.</p>
      </div>
      <div className="auth-body">
        <LoginForm />
      </div>
    </div>
  );
}
