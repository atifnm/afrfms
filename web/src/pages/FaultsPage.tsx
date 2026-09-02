import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import type { Airport, FaultSummary } from "../api/types";
import { StatusBeacon, faultStatusTone, severityTone } from "../components/StatusBeacon";
import { Card, EmptyState, ErrorBanner, Field, LoadingSpinner, PageHeader, inputClass } from "../components/ui";

export function FaultsPage() {
  const { user } = useAuth();
  const [airports, setAirports] = useState<Airport[]>([]);
  const [airportId, setAirportId] = useState<string | null>(user?.airport?.id ?? null);
  const [faults, setFaults] = useState<FaultSummary[] | null>(null);
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.airports().then((list) => {
      setAirports(list);
      if (!airportId && list.length > 0) setAirportId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!airportId) return;
    setLoading(true);
    api
      .faultsForAirport(airportId, { status: status || undefined, severity: severity || undefined })
      .then(setFaults)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load faults"))
      .finally(() => setLoading(false));
  }, [airportId, status, severity]);

  return (
    <div>
      <PageHeader title="Fault Queue" subtitle={airports.find((a) => a.id === airportId)?.name} />

      <div className="mb-4 flex flex-wrap gap-3">
        {airports.length > 1 && (
          <div className="w-48">
            <Field label="Airport">
              <select className={inputClass} value={airportId ?? ""} onChange={(e) => setAirportId(e.target.value)}>
                {airports.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <div className="w-40">
          <Field label="Status">
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
            </select>
          </Field>
        </div>
        <div className="w-40">
          <Field label="Severity">
            <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">All</option>
              <option value="critical">Critical</option>
              <option value="minor">Minor</option>
            </select>
          </Field>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : !faults || faults.length === 0 ? (
        <EmptyState title="No faults match these filters" hint="Nothing outstanding right now." />
      ) : (
        <div className="space-y-2">
          {faults.map((f) => (
            <Link key={f.id} to={`/faults/${f.id}?airportId=${airportId}`}>
              <Card className="flex items-center justify-between transition-shadow hover:shadow-md">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-ink-primary">{f.equipment.regNo}</span>
                    <StatusBeacon tone={severityTone(f.severity)} label={f.severity} />
                    {f.isOverdue && <span className="rounded bg-status-critical/10 px-2 py-0.5 text-xs font-semibold text-status-critical">OVERDUE</span>}
                  </div>
                  <p className="mt-1 text-sm text-ink-secondary">{f.description}</p>
                  <p className="mt-1 text-xs text-ink-faint">{f.reportedAt}</p>
                </div>
                <StatusBeacon tone={faultStatusTone(f.status)} label={f.status.replace("_", " ")} />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
