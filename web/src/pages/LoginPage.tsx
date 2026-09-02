import { FormEvent, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Button, ErrorBanner, Field, inputClass } from "../components/ui";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [cnic, setCnic] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(cnic, password);
      const from = (location.state as { from?: Location })?.from;
      navigate(from ? (from as unknown as string) : "/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/paa-logo.png" alt="Pakistan Airport Authority" className="h-16 w-16 rounded-full" />
          <h1 className="mt-4 font-display text-xl font-semibold text-white">AFRFMS</h1>
          <p className="mt-1 text-sm text-white/70">Airport Fire &amp; Rescue Fleet Management</p>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-lg">
          <div className="runway-rule mb-6" />
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="CNIC">
              <input
                className={inputClass}
                value={cnic}
                onChange={(e) => setCnic(e.target.value)}
                placeholder="10000-0000000-0"
                autoComplete="username"
                required
              />
            </Field>
            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            {error && <ErrorBanner message={error} />}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-white/50">Pakistan Airport Authority — Internal Use Only</p>
      </div>
    </div>
  );
}
