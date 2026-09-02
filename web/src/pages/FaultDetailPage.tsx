import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, ApiRequestError } from "../api/client";
import type { FaultDetail } from "../api/types";
import { StatusBeacon, faultStatusTone, severityTone } from "../components/StatusBeacon";
import { Button, Card, ErrorBanner, LoadingSpinner, PageHeader } from "../components/ui";

export function FaultDetailPage() {
  const { faultId } = useParams<{ faultId: string }>();
  const { user } = useAuth();

  const [fault, setFault] = useState<FaultDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");

  const canWork = user?.role === "MECH_TECHNICIAN" || user?.role === "MECH_OFFICER";
  const canResolve = user?.role === "MECH_OFFICER" || user?.role === "ADMIN" || user?.role === "GM_FIRE";

  const refresh = useCallback(async () => {
    if (!faultId) return;
    setLoading(true);
    try {
      const f = await api.faultDetail(faultId);
      setFault(f);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load fault");
    } finally {
      setLoading(false);
    }
  }, [faultId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) return <LoadingSpinner label="Loading fault…" />;
  if (error) return <ErrorBanner message={error} />;
  if (!fault) return null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={fault.equipment.regNo} subtitle={fault.description} />

      <div className="mb-4 flex items-center gap-4">
        <StatusBeacon tone={severityTone(fault.severity)} label={`${fault.severity} severity`} />
        <StatusBeacon tone={faultStatusTone(fault.status)} label={fault.status.replace("_", " ")} pulse={fault.status === "open"} />
      </div>

      {actionError && (
        <div className="mb-4">
          <ErrorBanner message={actionError} />
        </div>
      )}

      {fault.status !== "resolved" && canWork && (
        <Card className="mb-4">
          <p className="mb-3 font-display text-sm font-semibold text-ink-primary">Work this fault</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => run(() => api.acknowledgeFault(fault.id))}>
              Acknowledge
            </Button>
          </div>
          <div className="mt-4 space-y-2">
            <textarea
              className="w-full rounded-md border border-surface-hairline bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
              rows={2}
              placeholder="Add a diagnosis or repair note…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              variant="secondary"
              disabled={busy || !note.trim()}
              onClick={() =>
                run(async () => {
                  await api.addFaultLog(fault.id, note);
                  setNote("");
                })
              }
            >
              Add note
            </Button>
          </div>

          {canResolve && (
            <div className="mt-6 space-y-2 border-t border-surface-hairline pt-4">
              <p className="text-sm font-medium text-ink-primary">Resolve this fault</p>
              <textarea
                className="w-full rounded-md border border-surface-hairline bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
                rows={2}
                placeholder="Resolution notes (required)…"
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  disabled={busy || !resolutionNotes.trim()}
                  onClick={() =>
                    run(async () => {
                      await api.resolveFault(fault.id, resolutionNotes);
                      setResolutionNotes("");
                    })
                  }
                >
                  Resolve &amp; close
                </Button>
                {fault.severity === "critical" && (
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt("Reason for escalating to the Superintendent:");
                      if (reason) run(() => api.escalateFault(fault.id, reason));
                    }}
                  >
                    Escalate
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="mb-4">
        <p className="mb-3 font-display text-sm font-semibold text-ink-primary">Alerts</p>
        <div className="space-y-2">
          {fault.alerts.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-sm">
              <div>
                <p className="font-medium text-ink-primary">{a.recipient}</p>
                <p className="text-xs text-ink-faint">
                  {a.role} · {a.channel} · {a.sentAt}
                </p>
              </div>
              <span className={a.acknowledgedAt ? "text-status-active text-xs font-medium" : "text-ink-faint text-xs"}>
                {a.acknowledgedAt ? `Acknowledged ${a.acknowledgedAt}` : "Not yet acknowledged"}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <p className="mb-3 font-display text-sm font-semibold text-ink-primary">Diagnosis &amp; repair log</p>
        {fault.logs.length === 0 ? (
          <p className="text-sm text-ink-faint">No entries yet.</p>
        ) : (
          <div className="space-y-3">
            {fault.logs.map((l) => (
              <div key={l.id} className="border-b border-surface-hairline pb-2 last:border-0">
                <p className="text-sm text-ink-primary">{l.note}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  {l.author} ({l.role}) · {l.createdAt}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
