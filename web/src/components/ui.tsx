import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-surface-hairline bg-surface-card p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-primary">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-secondary">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="runway-rule mt-4" />
    </div>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const variants: Record<string, string> = {
    primary: "bg-brand text-white hover:bg-brand-deep",
    secondary: "border border-surface-hairline bg-white text-ink-primary hover:bg-surface",
    danger: "bg-status-critical text-white hover:opacity-90",
    ghost: "text-ink-secondary hover:bg-surface",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function LoadingSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-ink-secondary">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-gold border-t-transparent" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-surface-hairline bg-white/50 p-10 text-center">
      <p className="font-display text-base font-semibold text-ink-primary">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-secondary">{hint}</p>}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-status-critical/30 bg-status-critical/5 px-4 py-3 text-sm text-status-critical">
      {message}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-primary">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-surface-hairline bg-white px-3 py-2 text-sm text-ink-primary placeholder:text-ink-faint focus:border-brand focus:outline-none";
