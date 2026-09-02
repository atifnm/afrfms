import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, ApiRequestError } from "../api/client";
import type { Airport, ShiftGroup, ShiftSummary } from "../api/types";
import { Button, Card, EmptyState, ErrorBanner, Field, LoadingSpinner, PageHeader, inputClass } from "../components/ui";

export function ShiftsPage() {
  const { user } = useAuth();
  const [airports, setAirports] = useState<Airport[]>([]);
  const [airportId, setAirportId] = useState<string | null>(user?.airport?.id ?? null);
  const [shifts, setShifts] = useState<ShiftSummary[] | null>(null);
  const [shiftGroups, setShiftGroups] = useState<ShiftGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [shiftDate, setShiftDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shiftType, setShiftType] = useState<"morning" | "evening" | "night">("morning");
  const [shiftGroupId, setShiftGroupId] = useState("");
  const [creating, setCreating] = useState(false);

  const canCreate =
    user?.role === "TEAM_LEADER" ||
    user?.role === "SR_SUPDT" ||
    user?.role === "SUPDT" ||
    user?.role === "CFRO" ||
    user?.role === "ADMIN" ||
    user?.role === "GM_FIRE";

  const selectedAirport = airports.find((a) => a.id === airportId);
  const shiftTypeOptions: { value: "morning" | "evening" | "night"; label: string }[] =
    selectedAirport?.shiftPattern === "2_shift"
      ? [
          { value: "morning", label: "Morning (12hr)" },
          { value: "night", label: "Night (12hr)" },
        ]
      : [
          { value: "morning", label: "Morning" },
          { value: "evening", label: "Evening" },
          { value: "night", label: "Night" },
        ];

  useEffect(() => {
    if (!shiftTypeOptions.some((o) => o.value === shiftType)) {
      setShiftType(shiftTypeOptions[0].value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAirport?.shiftPattern]);

  useEffect(() => {
    api.airports().then((list) => {
      setAirports(list);
      if (!airportId && list.length > 0) setAirportId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!airportId) return;
    setLoading(true);
    Promise.all([api.listShifts(airportId), api.shiftGroups(airportId)])
      .then(([shiftList, groupList]) => {
        setShifts(shiftList);
        setShiftGroups(groupList);
        setShiftGroupId((current) => (groupList.some((g) => g.id === current) ? current : groupList[0]?.id ?? ""));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load shifts"))
      .finally(() => setLoading(false));
  }, [airportId]);

  async function handleCreate() {
    if (!airportId) return;
    setCreating(true);
    setError(null);
    try {
      await api.createShift(airportId, { shiftDate, shiftType, shiftGroupId });
      const list = await api.listShifts(airportId);
      setShifts(list);
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create shift");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Shifts"
        subtitle={airports.find((a) => a.id === airportId)?.name}
        action={canCreate ? <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Cancel" : "Open a shift"}</Button> : undefined}
      />

      {airports.length > 1 && (
        <div className="mb-4 max-w-xs">
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

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {showCreate && (
        <Card className="mb-6">
          <p className="mb-3 font-display text-sm font-semibold text-ink-primary">Open a new shift</p>
          {shiftGroups.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              No crews set up at this airport yet. Add crews (A, B, C, D…) on the{" "}
              <Link to="/shift-groups" className="text-brand underline">
                Shift Groups
              </Link>{" "}
              page before opening a shift.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Date">
                <input type="date" className={inputClass} value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} />
              </Field>
              <Field label="Shift">
                <select className={inputClass} value={shiftType} onChange={(e) => setShiftType(e.target.value as typeof shiftType)}>
                  {shiftTypeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Crew">
                <select className={inputClass} value={shiftGroupId} onChange={(e) => setShiftGroupId(e.target.value)}>
                  {shiftGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      Crew {g.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Button onClick={handleCreate} disabled={creating || !shiftGroupId}>
                {creating ? "Opening…" : "Open shift"}
              </Button>
            </div>
          )}
        </Card>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : !shifts || shifts.length === 0 ? (
        <EmptyState title="No shifts yet" hint={canCreate ? "Open a shift to start assigning vehicles." : "Check back once a Team Leader opens a shift."} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shifts.map((s) => (
            <Link key={s.id} to={`/shifts/${s.id}?airportId=${airportId}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <p className="font-display text-base font-semibold capitalize text-ink-primary">{s.shiftType} shift</p>
                <p className="mt-1 text-sm text-ink-secondary">
                  {s.shiftDate}
                  {s.shiftGroupName ? ` · Crew ${s.shiftGroupName}` : ""}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
