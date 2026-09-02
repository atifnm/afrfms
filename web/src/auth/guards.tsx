import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import type { Role } from "../api/types";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!roles.includes(user.role)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-lg border border-surface-hairline bg-surface-card p-8 text-center">
        <p className="font-display text-lg font-semibold text-ink-primary">Not available for your role</p>
        <p className="mt-2 text-sm text-ink-secondary">
          This section is restricted. If you believe you should have access, contact your Administrator.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
