import { useEffect, useState, useCallback } from "react";
import { api, ApiRequestError } from "../api/client";
import type { MyAssignmentDetail, MyAssignmentSummary, ShiftSummary, SubmitInspectionResult } from "../api/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingSpinner, PageHeader } from "../components/ui";
import { StatusBeacon } from "../components/StatusBeacon";

type ResponseState = Record<string, { value: string; remarks: string; photoUrl: string }>;

export function DriverAssignmentPage() {
  const [shifts, setShifts] = useState<ShiftSummary[] | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<MyAssignmentSummary[] | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which shift(s) does the driver have today?
  useEffect(() => {
    api
      .todayForMe()
      .then((list) => {
        setShifts(list);
        if (list.length === 1) setSelectedShiftId(list[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your shift"))
      .finally(() => setLoading(false));
  }, []);

  const loadAssignments = useCallback((shiftId: string) => {
    setLoading(true);
    setError(null);
    api
      .myAssignments(shiftId)
      .then(setAssignments)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your assignments"))
      .finally(() => setLoading(false));
  }, []);

  // Every vehicle assigned to the driver for the selected shift.
  useEffect(() => {
    if (!selectedShiftId) return;
    loadAssignments(selectedShiftId);
  }, [selectedShiftId, loadAssignments]);

  if (loading && !assignments) return <LoadingSpinner label="Loading your shift…" />;

  if (shifts && shifts.length === 0) {
    return (
      <div>
        <PageHeader title="My Shift" />
        <EmptyState
          title="No vehicle assigned to you today"
          hint="Check with your Team Leader if you were expecting an assignment."
        />
      </div>
    );
  }

  if (shifts && shifts.length > 1 && !selectedShiftId) {
    return (
      <div>
        <PageHeader title="My Shift" subtitle="You have more than one shift today — choose one" />
        <div className="space-y-3">
          {shifts.map((s) => (
            <Card key={s.id} className="cursor-pointer hover:border-brand">
              <button className="w-full text-left" onClick={() => setSelectedShiftId(s.id)}>
                <p className="font-display font-semibold capitalize">{s.shiftType} shift</p>
                <p className="text-sm text-ink-secondary">{s.shiftDate}</p>
              </button>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!selectedShiftId || !assignments) return null;

  if (selectedAssignmentId) {
    return (
      <ChecklistForm
        shiftId={selectedShiftId}
        assignmentId={selectedAssignmentId}
        onBack={() => setSelectedAssignmentId(null)}
        onSubmitted={() => {
          setSelectedAssignmentId(null);
          loadAssignments(selectedShiftId);
        }}
      />
    );
  }

  // A driver may have more than one vehicle in a shift — always show the
  // picker (even for one vehicle) so the flow is consistent, but skip
  // straight past it when there's only one and it's still pending.
  if (assignments.length === 1 && !assignments[0].alreadySubmitted) {
    return (
      <ChecklistForm
        shiftId={selectedShiftId}
        assignmentId={assignments[0].assignmentId}
        onBack={null}
        onSubmitted={() => loadAssignments(selectedShiftId)}
      />
    );
  }

  const remaining = assignments.filter((a) => !a.alreadySubmitted);
  const done = assignments.filter((a) => a.alreadySubmitted);

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="My Shift" subtitle={`${assignments.length} vehicle${assignments.length === 1 ? "" : "s"} assigned to you`} />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {remaining.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 text-sm font-medium text-ink-primary">To do</p>
          <div className="space-y-2">
            {remaining.map((a) => (
              <Card key={a.assignmentId} className="cursor-pointer hover:border-brand">
                <button className="flex w-full items-center justify-between text-left" onClick={() => setSelectedAssignmentId(a.assignmentId)}>
                  <div>
                    <p className="font-mono font-semibold text-ink-primary">{a.equipment.regNo}</p>
                    <p className="text-xs text-ink-faint">Odometer: {a.equipment.currentOdometer.toLocaleString()} km</p>
                  </div>
                  <StatusBeacon tone="neutral" label="Not started" />
                </button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-ink-primary">Completed</p>
          <div className="space-y-2">
            {done.map((a) => (
              <Card key={a.assignmentId}>
                <div className="flex items-center justify-between">
                  <p className="font-mono font-semibold text-ink-secondary">{a.equipment.regNo}</p>
                  <StatusBeacon tone="active" label="Submitted" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {remaining.length === 0 && (
        <p className="mt-6 text-center text-sm text-ink-faint">
          All vehicles inspected for this shift. Safe duty.
        </p>
      )}
    </div>
  );
}

function ChecklistForm({
  shiftId,
  assignmentId,
  onBack,
  onSubmitted,
}: {
  shiftId: string;
  assignmentId: string;
  onBack: (() => void) | null;
  onSubmitted: () => void;
}) {
  const [assignment, setAssignment] = useState<MyAssignmentDetail | null>(null);
  const [odometer, setOdometer] = useState("");
  const [responses, setResponses] = useState<ResponseState>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitInspectionResult | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .myAssignmentDetail(shiftId, assignmentId)
      .then((a) => {
        setAssignment(a);
        setOdometer(String(a.equipment.currentOdometer));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load checklist"))
      .finally(() => setLoading(false));
  }, [shiftId, assignmentId]);

  function setValue(itemId: string, value: string) {
    setResponses((prev) => ({ ...prev, [itemId]: { value, remarks: prev[itemId]?.remarks ?? "", photoUrl: prev[itemId]?.photoUrl ?? "" } }));
  }
  function setRemarks(itemId: string, remarks: string) {
    setResponses((prev) => ({ ...prev, [itemId]: { value: prev[itemId]?.value ?? "", remarks, photoUrl: prev[itemId]?.photoUrl ?? "" } }));
  }
  function setPhotoUrl(itemId: string, photoUrl: string) {
    setResponses((prev) => ({ ...prev, [itemId]: { value: prev[itemId]?.value ?? "", remarks: prev[itemId]?.remarks ?? "", photoUrl } }));
  }

  async function handleSubmit() {
    if (!assignment) return;
    setError(null);

    const items = assignment.checklist.items;
    const missing = items.filter((i) => !responses[i.id]?.value);
    if (missing.length > 0) {
      setError(`Please answer every item — ${missing.length} remaining.`);
      return;
    }
    const failedWithoutRemarks = items.filter(
      (i) => i.inputType === "boolean" && responses[i.id]?.value === "fail" && !responses[i.id]?.remarks
    );
    if (failedWithoutRemarks.length > 0) {
      setError("Every item marked Fail needs a short note describing the fault.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = items.map((i) => ({
        checklistItemId: i.id,
        value: responses[i.id].value,
        remarks: responses[i.id].remarks || undefined,
        photoUrl: responses[i.id].photoUrl || undefined,
      }));
      const res = await api.submitInspection(shiftId, assignmentId, Number(odometer), payload);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Submission failed — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingSpinner label="Loading checklist…" />;
  if (error && !assignment) return <ErrorBanner message={error} />;
  if (!assignment) return null;

  if (result) {
    const hasCritical = result.faultsCreated.some((f) => f.severity === "critical");
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="Checklist submitted" />
        <Card>
          <p className="font-display text-lg font-semibold text-status-active">Submission recorded ✓</p>
          {result.equipmentGrounded ? (
            <div className="mt-4 rounded-md bg-status-critical/10 p-4 text-sm text-status-critical">
              <p className="font-semibold">This vehicle has been grounded.</p>
              <p className="mt-1">
                A critical fault was found and Mechanical Officers have been alerted. Do not operate this vehicle
                until Maintenance clears it.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-secondary">No critical faults — vehicle remains active.</p>
          )}
          {result.faultsCreated.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-ink-primary">Faults reported this submission:</p>
              <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
                {result.faultsCreated.map((f) => (
                  <li key={f.id}>
                    • {f.label} —{" "}
                    <span className={f.severity === "critical" ? "text-status-critical" : "text-status-progress"}>
                      {f.severity}
                    </span>{" "}
                    ({f.alertsSent} technician{f.alertsSent === 1 ? "" : "s"} notified)
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button className="mt-6 w-full" onClick={onSubmitted}>
            {hasCritical ? "Continue" : "Back to my vehicles"}
          </Button>
        </Card>
      </div>
    );
  }

  if (assignment.alreadySubmitted) {
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="My Shift" />
        <EmptyState
          title={`Checklist already submitted for ${assignment.equipment.regNo}`}
          hint="You've already completed your inspection for this vehicle this shift."
        />
        {onBack && (
          <Button variant="secondary" className="mt-4" onClick={onBack}>
            Back
          </Button>
        )}
      </div>
    );
  }

  const sections = Array.from(new Set(assignment.checklist.items.map((i) => i.section)));

  return (
    <div className="mx-auto max-w-lg pb-24">
      <PageHeader
        title={`Vehicle ${assignment.equipment.regNo}`}
        subtitle="Complete every item before submitting"
        action={
          onBack ? (
            <button onClick={onBack} className="text-sm font-medium text-brand underline">
              Back to my vehicles
            </button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <Card className="mb-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-primary">Odometer reading (km)</span>
          <input
            type="number"
            className="w-full rounded-md border border-surface-hairline bg-white px-3 py-3 font-mono text-lg text-ink-primary focus:border-brand focus:outline-none"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            inputMode="numeric"
          />
        </label>
      </Card>

      {sections.map((section) => (
        <Card key={section} className="mb-4">
          <p className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-brand">{section}</p>
          <div className="space-y-5">
            {assignment.checklist.items
              .filter((i) => i.section === section)
              .map((item) => {
                const current = responses[item.id];
                return (
                  <div key={item.id} className="border-b border-surface-hairline pb-4 last:border-0 last:pb-0">
                    <p className="text-sm font-medium text-ink-primary">
                      {item.label}
                      {item.isCritical && <span className="ml-2 text-xs font-semibold text-status-critical">CRITICAL</span>}
                    </p>

                    {item.inputType === "boolean" && (
                      <div className="mt-2 flex gap-3">
                        <button
                          type="button"
                          onClick={() => setValue(item.id, "pass")}
                          className={`flex-1 rounded-md border-2 py-3 text-sm font-semibold transition-colors ${
                            current?.value === "pass"
                              ? "border-status-active bg-status-active/10 text-status-active"
                              : "border-surface-hairline text-ink-secondary hover:border-status-active/50"
                          }`}
                        >
                          Pass
                        </button>
                        <button
                          type="button"
                          onClick={() => setValue(item.id, "fail")}
                          className={`flex-1 rounded-md border-2 py-3 text-sm font-semibold transition-colors ${
                            current?.value === "fail"
                              ? "border-status-critical bg-status-critical/10 text-status-critical"
                              : "border-surface-hairline text-ink-secondary hover:border-status-critical/50"
                          }`}
                        >
                          Fail
                        </button>
                      </div>
                    )}

                    {item.inputType === "numeric" && (
                      <input
                        type="number"
                        className="mt-2 w-full rounded-md border border-surface-hairline bg-white px-3 py-2 font-mono text-sm focus:border-brand focus:outline-none"
                        value={current?.value ?? ""}
                        onChange={(e) => setValue(item.id, e.target.value)}
                      />
                    )}

                    {item.inputType === "text" && (
                      <textarea
                        className="mt-2 w-full rounded-md border border-surface-hairline bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
                        rows={2}
                        value={current?.value ?? ""}
                        onChange={(e) => setValue(item.id, e.target.value)}
                      />
                    )}

                    {item.inputType === "boolean" && current?.value === "fail" && (
                      <div className="mt-3 space-y-2 rounded-md bg-status-critical/5 p-3">
                        <textarea
                          placeholder="Describe the fault (required)"
                          className="w-full rounded-md border border-status-critical/30 bg-white px-3 py-2 text-sm focus:border-status-critical focus:outline-none"
                          rows={2}
                          value={current.remarks}
                          onChange={(e) => setRemarks(item.id, e.target.value)}
                        />
                        <input
                          placeholder="Photo reference / URL (optional)"
                          className="w-full rounded-md border border-status-critical/30 bg-white px-3 py-2 text-sm focus:border-status-critical focus:outline-none"
                          value={current.photoUrl}
                          onChange={(e) => setPhotoUrl(item.id, e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </Card>
      ))}

      <div className="fixed bottom-0 left-0 right-0 border-t border-surface-hairline bg-white px-4 py-4 md:left-64 md:px-8">
        <Button className="w-full py-3 text-base" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit checklist"}
        </Button>
      </div>
    </div>
  );
}
