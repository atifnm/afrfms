import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, ApiRequestError } from "../api/client";
import type { Equipment, ShiftLive, ShiftReport, StaffRosterEntry } from "../api/types";
import { StatusBeacon } from "../components/StatusBeacon";
import { Button, Card, ErrorBanner, Field, LoadingSpinner, PageHeader, inputClass } from "../components/ui";

const ASSIGNMENT_TONE: Record<string, "active" | "progress" | "critical" | "neutral"> = {
  completed: "active",
  pending: "neutral",
  exception: "progress",
};

export function ShiftDetailPage() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const [searchParams] = useSearchParams();
  const airportId = searchParams.get("airportId");
  const { user } = useAuth();

  const [live, setLive] = useState<ShiftLive | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [drivers, setDrivers] = useState<{ id: string; fullName: string }[]>([]);
  const [staff, setStaff] = useState<StaffRosterEntry[]>([]);
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [assignEquipmentId, setAssignEquipmentId] = useState("");
  const [assignDriverId, setAssignDriverId] = useState("");
  const [assignSupervisorId, setAssignSupervisorId] = useState("");
  const [assignSuperintendentId, setAssignSuperintendentId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [summary, setSummary] = useState("");
  const [generating, setGenerating] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const canManage =
    user?.role === "TEAM_LEADER" ||
    user?.role === "SR_SUPDT" ||
    user?.role === "SUPDT" ||
    user?.role === "CFRO" ||
    user?.role === "ADMIN" ||
    user?.role === "GM_FIRE";

  const refresh = useCallback(async () => {
    if (!airportId || !shiftId) return;
    setLoading(true);
    setError(null);
    try {
      const [liveData, equipmentData] = await Promise.all([api.shiftLive(airportId, shiftId), api.equipment(airportId)]);
      setLive(liveData);
      setEquipment(equipmentData);
      if (canManage) {
        const [driverList, staffList] = await Promise.all([api.drivers(airportId), api.shiftEligibleStaff(airportId)]);
        setDrivers(driverList);
        setStaff(staffList);
      }
      try {
        const r = await api.getReport(airportId, shiftId);
        setReport(r);
      } catch {
        setReport(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shift");
    } finally {
      setLoading(false);
    }
  }, [airportId, shiftId, canManage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!airportId || !shiftId) return <ErrorBanner message="Missing airport or shift reference." />;
  if (loading) return <LoadingSpinner label="Loading shift…" />;
  if (error) {
    return (
      <div>
        <PageHeader title="Shift" />
        <ErrorBanner message={error} />
      </div>
    );
  }
  if (!live) return null;

  const supervisors = staff.filter((s) => s.role === "SUPVR");
  const superintendents = staff.filter((s) => s.role === "SR_SUPDT" || s.role === "SUPDT");
  const assignedEquipmentIds = new Set(live.assignments.map((a) => a.equipment.id));
  const assignableEquipment = equipment.filter((e) => e.status === "active" && !assignedEquipmentIds.has(e.id));
  const allSettled = live.assignments.length > 0 && live.assignments.every((a) => a.status !== "pending");

  async function handleAssign() {
    if (!assignEquipmentId || !assignDriverId) return;
    setAssigning(true);
    setActionError(null);
    try {
      await api.assignVehicle(airportId!, shiftId!, {
        equipmentId: assignEquipmentId,
        driverId: assignDriverId,
        supervisorId: assignSupervisorId || undefined,
        superintendentId: assignSuperintendentId || undefined,
      });
      setAssignEquipmentId("");
      setAssignDriverId("");
      setAssignSupervisorId("");
      setAssignSuperintendentId("");
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Failed to assign vehicle");
    } finally {
      setAssigning(false);
    }
  }

  async function handleException(assignmentId: string) {
    const reason = window.prompt("Reason this vehicle isn't being inspected this shift:");
    if (!reason) return;
    setActionError(null);
    try {
      await api.markException(airportId!, shiftId!, assignmentId, reason);
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Failed to log exception");
    }
  }

  async function handleGenerateReport() {
    setGenerating(true);
    setActionError(null);
    try {
      const r = await api.generateReport(airportId!, shiftId!, summary || undefined);
      setReport(r);
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadPdf() {
    setDownloadingPdf(true);
    setActionError(null);
    try {
      const filename = `shift-handover-${live!.shiftDate}-${live!.shiftType}.pdf`;
      await api.downloadReportPdf(airportId!, shiftId!, filename);
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Failed to download PDF");
    } finally {
      setDownloadingPdf(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={`${live.shiftType[0].toUpperCase()}${live.shiftType.slice(1)} shift`}
        subtitle={`${live.shiftDate}${live.shiftGroupName ? ` · Crew ${live.shiftGroupName}` : ""}`}
      />

      {actionError && (
        <div className="mb-4">
          <ErrorBanner message={actionError} />
        </div>
      )}

      <Card className="mb-6 overflow-x-auto">
        <p className="mb-3 font-display text-sm font-semibold text-ink-primary">Assignments</p>
        {live.assignments.length === 0 ? (
          <p className="text-sm text-ink-secondary">No vehicles assigned to this shift yet.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-surface-hairline text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="pb-2 pr-4">Vehicle</th>
                <th className="pb-2 pr-4">Driver</th>
                <th className="pb-2 pr-4">Supvr</th>
                <th className="pb-2 pr-4">Sr Supdt/Supdt</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Odometer</th>
                {canManage && <th className="pb-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {live.assignments.map((a) => (
                <tr key={a.assignmentId} className="border-b border-surface-hairline last:border-0">
                  <td className="py-2.5 pr-4 font-mono">{a.equipment.regNo}</td>
                  <td className="py-2.5 pr-4">{a.driver.name}</td>
                  <td className="py-2.5 pr-4 text-ink-secondary">{a.supervisor?.name ?? "—"}</td>
                  <td className="py-2.5 pr-4 text-ink-secondary">{a.superintendent?.name ?? "—"}</td>
                  <td className="py-2.5 pr-4">
                    <StatusBeacon tone={ASSIGNMENT_TONE[a.status]} label={a.status} />
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-ink-secondary">
                    {a.submission ? a.submission.odometerReading.toLocaleString() : "—"}
                  </td>
                  {canManage && (
                    <td className="py-2.5">
                      {a.status === "pending" && (
                        <button onClick={() => handleException(a.assignmentId)} className="text-xs font-medium text-brand underline">
                          Log exception
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {canManage && !report && (
        <Card className="mb-6">
          <p className="mb-3 font-display text-sm font-semibold text-ink-primary">Assign a vehicle</p>
          <p className="mb-3 text-xs text-ink-faint">Driver is required. Supvr and Sr Supdt/Supdt are optional — name the crew on duty for this vehicle this shift.</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Vehicle">
              <select className={inputClass} value={assignEquipmentId} onChange={(e) => setAssignEquipmentId(e.target.value)}>
                <option value="">Select…</option>
                {assignableEquipment.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.regNo} — {e.category}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Driver">
              <select className={inputClass} value={assignDriverId} onChange={(e) => setAssignDriverId(e.target.value)}>
                <option value="">Select…</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Supvr (optional)">
              <select className={inputClass} value={assignSupervisorId} onChange={(e) => setAssignSupervisorId(e.target.value)}>
                <option value="">None</option>
                {supervisors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sr Supdt/Supdt (optional)">
              <select className={inputClass} value={assignSuperintendentId} onChange={(e) => setAssignSuperintendentId(e.target.value)}>
                <option value="">None</option>
                {superintendents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={handleAssign} disabled={assigning || !assignEquipmentId || !assignDriverId}>
              {assigning ? "Assigning…" : "Assign"}
            </Button>
          </div>
          {assignableEquipment.length === 0 && (
            <p className="mt-2 text-xs text-ink-faint">No more active, unassigned vehicles at this airport.</p>
          )}
        </Card>
      )}

      {canManage && !report && (
        <Card>
          <p className="mb-3 font-display text-sm font-semibold text-ink-primary">Shift report</p>
          {!allSettled ? (
            <p className="text-sm text-ink-secondary">
              Every vehicle needs a submitted checklist or a logged exception before the report can be generated.
            </p>
          ) : (
            <div className="space-y-3">
              <Field label="Summary (optional)">
                <textarea className={inputClass} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
              </Field>
              <Button onClick={handleGenerateReport} disabled={generating}>
                {generating ? "Generating…" : "Generate & issue report"}
              </Button>
            </div>
          )}
        </Card>
      )}

      {report && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-sm font-semibold text-ink-primary">Shift report</p>
            <Button onClick={handleDownloadPdf} disabled={downloadingPdf} variant="secondary">
              {downloadingPdf ? "Preparing…" : "Download PDF handover report"}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Fleet health" value={`${report.fleetHealthScore}`} />
            <Stat label="Inspected" value={`${report.vehiclesInspected}`} />
            <Stat label="Exceptions" value={`${report.vehiclesException}`} />
            <Stat label="Faults resolved" value={`${report.faultsResolved}`} />
          </div>
          <div className="mt-4 flex gap-4 text-sm">
            <span className="text-status-critical">{report.faultsRaisedCritical} critical fault(s)</span>
            <span className="text-status-progress">{report.faultsRaisedMinor} minor fault(s)</span>
          </div>
          {report.summary && <p className="mt-4 text-sm text-ink-secondary">{report.summary}</p>}
          <p className="mt-4 text-xs text-ink-faint">
            Issued by {report.generatedBy} · {report.generatedAt}
          </p>

          {report.equipment.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Full fleet — this airport</p>
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-surface-hairline text-left text-xs uppercase tracking-wide text-ink-faint">
                    <th className="pb-2 pr-3">Vehicle</th>
                    <th className="pb-2 pr-3">Crew on duty</th>
                    <th className="pb-2 pr-3">Prev. odo.</th>
                    <th className="pb-2 pr-3">Curr. odo.</th>
                    <th className="pb-2">Faults</th>
                  </tr>
                </thead>
                <tbody>
                  {report.equipment.map((e) => (
                    <tr key={e.equipmentId} className="border-b border-surface-hairline last:border-0">
                      <td className="py-2 pr-3 font-mono">{e.regNo}</td>
                      <td className="py-2 pr-3 text-ink-secondary">
                        {[e.checkedBy && `${e.checkedBy} (Driver)`, e.supervisorOnDuty && `${e.supervisorOnDuty} (Supvr)`, e.superintendentOnDuty && `${e.superintendentOnDuty} (Sr Supdt/Supdt)`]
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </td>
                      <td className="py-2 pr-3 font-mono text-ink-secondary">{e.previousOdometer?.toLocaleString() ?? "—"}</td>
                      <td className="py-2 pr-3 font-mono text-ink-secondary">{e.currentOdometer.toLocaleString()}</td>
                      <td className="py-2">
                        {e.faults.length === 0 ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          e.faults.map((f, i) => (
                            <div key={i} className={f.severity === "critical" ? "text-status-critical" : "text-status-progress"}>
                              {f.description} — {f.rectified ? "Rectified" : "Open"}
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-2xl font-semibold text-brand">{value}</p>
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}
