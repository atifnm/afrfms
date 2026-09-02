import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import { api, ApiRequestError } from "../api/client";
import type { Airport, ShiftGroup, StaffRosterEntry } from "../api/types";
import { ROLE_LABELS } from "../api/types";
import { Button, Card, EmptyState, ErrorBanner, Field, LoadingSpinner, PageHeader, inputClass } from "../components/ui";

export function ShiftGroupsPage() {
  const { user } = useAuth();
  const [airports, setAirports] = useState<Airport[]>([]);
  const [airportId, setAirportId] = useState<string | null>(null);
  const [groups, setGroups] = useState<ShiftGroup[] | null>(null);
  const [staff, setStaff] = useState<StaffRosterEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.airports().then((list) => {
      setAirports(list);
      // A CFRO/Superintendent is airport-scoped, so their own airport is
      // always the right default; national roles (Admin/GM Fire) just get
      // the first airport in the list and can switch.
      const defaultId = user?.airport?.id ?? list[0]?.id ?? null;
      setAirportId(defaultId);
    });
  }, [user]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [groupList, staffList] = await Promise.all([api.shiftGroups(id), api.shiftEligibleStaff(id)]);
      setGroups(groupList);
      setStaff(staffList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shift groups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (airportId) load(airportId);
  }, [airportId, load]);

  async function handleCreate() {
    if (!airportId) return;
    setCreating(true);
    setError(null);
    try {
      await api.createShiftGroup(airportId, newName);
      setNewName("");
      load(airportId);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create shift group");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(groupId: string) {
    if (!airportId) return;
    if (!window.confirm("Delete this shift group? It must have no members.")) return;
    try {
      await api.deleteShiftGroup(airportId, groupId);
      load(airportId);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to delete shift group");
    }
  }

  async function handleAppoint(person: StaffRosterEntry, newGroupId: string) {
    if (!airportId) return;
    setError(null);
    try {
      if (person.shiftGroupId) {
        await api.removeFromShiftGroup(airportId, person.shiftGroupId, person.id);
      }
      if (newGroupId) {
        await api.assignToShiftGroup(airportId, newGroupId, person.id);
      }
      load(airportId);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to appoint this person to a crew");
    }
  }

  return (
    <div>
      <PageHeader
        title="Shift Groups"
        subtitle="Rotation crews (A, B, C, D…) — appoint Team Leaders, Sr Supdts, Supdts, Supvrs, Asstts, and Drivers to a crew. Which crew works which shift is chosen per date when a shift is opened."
      />

      {airports.length > 1 && (
        <div className="mb-6 max-w-xs">
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

      <Card className="mb-6">
        <p className="mb-3 font-display text-sm font-semibold text-ink-primary">Add a crew</p>
        <div className="flex items-end gap-3">
          <Field label="Name">
            <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. A" />
          </Field>
          <Button disabled={creating || !newName.trim()} onClick={handleCreate}>
            {creating ? "Creating…" : "Add crew"}
          </Button>
        </div>
      </Card>

      {loading ? (
        <LoadingSpinner />
      ) : !groups || groups.length === 0 ? (
        <EmptyState title="No shift groups yet" hint="Add crews like A, B, C, D to organize your rotation roster." />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {groups.map((g) => (
              <Card key={g.id}>
                <div className="flex items-start justify-between">
                  <p className="font-display text-lg font-semibold text-brand">Crew {g.name}</p>
                  <button onClick={() => handleDelete(g.id)} className="text-xs font-medium text-status-critical underline">
                    Delete
                  </button>
                </div>
                <div className="mt-4 space-y-1 text-sm text-ink-secondary">
                  <p>Team Leaders: {g.memberCounts.teamLeaders}</p>
                  <p>Sr Supdts: {g.memberCounts.srSupdts}</p>
                  <p>Supdts: {g.memberCounts.supdts}</p>
                  <p>Supvrs: {g.memberCounts.supvrs}</p>
                  <p>Asstts: {g.memberCounts.asstts}</p>
                  <p>Drivers: {g.memberCounts.drivers}</p>
                </div>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-x-auto sm:block">
            <p className="mb-3 font-display text-sm font-semibold text-ink-primary">Roster — appoint staff to a crew</p>
            {!staff || staff.length === 0 ? (
              <p className="text-sm text-ink-secondary">No Team Leaders, fire crew, or Drivers at this airport yet.</p>
            ) : (
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-surface-hairline text-left text-xs uppercase tracking-wide text-ink-faint">
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Role</th>
                    <th className="pb-2">Crew</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((person) => (
                    <tr key={person.id} className="border-b border-surface-hairline last:border-0">
                      <td className="py-2.5 pr-4 font-medium">{person.fullName}</td>
                      <td className="py-2.5 pr-4 text-ink-secondary">{ROLE_LABELS[person.role]}</td>
                      <td className="py-2.5">
                        <select
                          className={`${inputClass} max-w-[10rem]`}
                          value={person.shiftGroupId ?? ""}
                          onChange={(e) => handleAppoint(person, e.target.value)}
                        >
                          <option value="">Unassigned</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              Crew {g.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="sm:hidden">
            <p className="mb-3 font-display text-sm font-semibold text-ink-primary">Roster — appoint staff to a crew</p>
            {!staff || staff.length === 0 ? (
              <p className="text-sm text-ink-secondary">No Team Leaders, fire crew, or Drivers at this airport yet.</p>
            ) : (
              <div className="space-y-3">
                {staff.map((person) => (
                  <div key={person.id} className="border-b border-surface-hairline pb-3 last:border-0 last:pb-0">
                    <p className="font-medium text-ink-primary">{person.fullName}</p>
                    <p className="mb-2 text-xs text-ink-secondary">{ROLE_LABELS[person.role]}</p>
                    <select
                      className={inputClass}
                      value={person.shiftGroupId ?? ""}
                      onChange={(e) => handleAppoint(person, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          Crew {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
