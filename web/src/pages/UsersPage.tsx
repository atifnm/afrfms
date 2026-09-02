import { useEffect, useState } from "react";
import { api, ApiRequestError } from "../api/client";
import type { AdminUser, Airport, Role, ShiftGroup } from "../api/types";
import { ROLE_LABELS } from "../api/types";
import { Button, Card, ErrorBanner, Field, LoadingSpinner, PageHeader, inputClass } from "../components/ui";
import { useAuth } from "../auth/AuthContext";

const ROLES: Role[] = [
  "GM_FIRE",
  "CFRO",
  "TEAM_LEADER",
  "SR_SUPDT",
  "SUPDT",
  "SUPVR",
  "ASSTT",
  "DRIVER",
  "MECH_TECHNICIAN",
  "MECH_OFFICER",
  "ADMIN",
];
const NATIONAL_ROLES: Role[] = ["ADMIN", "GM_FIRE"];
const SHIFT_GROUP_ROLES: Role[] = ["TEAM_LEADER", "SR_SUPDT", "SUPDT", "SUPVR", "ASSTT", "DRIVER"];
// Roles a CFRO is allowed to appoint/manage at their own airport — the Team
// Leader, the four firefighter ranks, drivers, and maintenance staff. A CFRO
// can never create/promote someone to CFRO, Admin, or GM Fire.
const CFRO_MANAGEABLE_ROLES: Role[] = ["TEAM_LEADER", "SR_SUPDT", "SUPDT", "SUPVR", "ASSTT", "DRIVER", "MECH_TECHNICIAN", "MECH_OFFICER"];

export function UsersPage() {
  const { user: me } = useAuth();
  const isCfro = me?.role === "CFRO";
  const assignableRoles = isCfro ? CFRO_MANAGEABLE_ROLES : ROLES;
  const myAirportId = me?.airport?.id ?? "";

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [airports, setAirports] = useState<Airport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [cnic, setCnic] = useState("");
  const [password, setPassword] = useState("");
  const [roleName, setRoleName] = useState<Role>(isCfro ? "ASSTT" : "DRIVER");
  const [airportId, setAirportId] = useState(isCfro ? myAirportId : "");
  const [shiftGroupId, setShiftGroupId] = useState("");
  const [createGroups, setCreateGroups] = useState<ShiftGroup[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function loadUsers() {
    setLoading(true);
    api
      .listUsers()
      .then(setUsers)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load users"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadUsers();
    api.airports().then(setAirports);
  }, []);

  useEffect(() => {
    if (airportId && SHIFT_GROUP_ROLES.includes(roleName)) {
      api.shiftGroups(airportId).then(setCreateGroups);
    } else {
      setCreateGroups([]);
      setShiftGroupId("");
    }
  }, [airportId, roleName]);

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      await api.createUser({
        fullName,
        cnic,
        password,
        roleName,
        airportId: NATIONAL_ROLES.includes(roleName) ? undefined : airportId,
        shiftGroupId: shiftGroupId || undefined,
      });
      setFullName("");
      setCnic("");
      setPassword("");
      setAirportId("");
      setShiftGroupId("");
      setShowCreate(false);
      loadUsers();
    } catch (err) {
      setCreateError(err instanceof ApiRequestError ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <PageHeader title="Users" action={<Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Cancel" : "New user"}</Button>} />

      {showCreate && (
        <Card className="mb-6">
          <p className="mb-3 font-display text-sm font-semibold text-ink-primary">Create a user</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Full name">
              <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <Field label="CNIC">
              <input className={inputClass} value={cnic} onChange={(e) => setCnic(e.target.value)} placeholder="10000-0000000-0" />
            </Field>
            <Field label="Temporary password">
              <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Role">
              <select className={inputClass} value={roleName} onChange={(e) => setRoleName(e.target.value as Role)}>
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            {!NATIONAL_ROLES.includes(roleName) && (
              <Field label="Airport">
                {isCfro ? (
                  <input className={inputClass} value={me?.airport?.name ?? ""} disabled />
                ) : (
                  <select className={inputClass} value={airportId} onChange={(e) => setAirportId(e.target.value)}>
                    <option value="">Select…</option>
                    {airports.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            {SHIFT_GROUP_ROLES.includes(roleName) && airportId && (
              <Field label="Shift group (optional)">
                <select className={inputClass} value={shiftGroupId} onChange={(e) => setShiftGroupId(e.target.value)}>
                  <option value="">None</option>
                  {createGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      Crew {g.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          {createError && (
            <div className="mt-3">
              <ErrorBanner message={createError} />
            </div>
          )}
          <Button
            className="mt-4"
            onClick={handleCreate}
            disabled={creating || !fullName || !cnic || password.length < 8 || (!NATIONAL_ROLES.includes(roleName) && !airportId)}
          >
            {creating ? "Creating…" : "Create user"}
          </Button>
        </Card>
      )}

      {error && <ErrorBanner message={error} />}
      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* Desktop / wide screens: table */}
          <Card className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-surface-hairline text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">CNIC</th>
                  <th className="pb-2 pr-4">Role</th>
                  <th className="pb-2 pr-4">Airport</th>
                  <th className="pb-2 pr-4">Crew</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users?.map((u) =>
                  editingUserId === u.id ? (
                    <tr key={u.id} className="border-b border-surface-hairline bg-surface/60">
                      <td colSpan={7} className="py-3">
                        <UserEditFields
                          user={u}
                          airports={airports}
                          isCfro={isCfro}
                          assignableRoles={assignableRoles}
                          onCancel={() => setEditingUserId(null)}
                          onSaved={() => {
                            setEditingUserId(null);
                            loadUsers();
                          }}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={u.id} className="border-b border-surface-hairline last:border-0">
                      <td className="py-2.5 pr-4 font-medium">{u.fullName}</td>
                      <td className="py-2.5 pr-4 font-mono text-ink-secondary">{u.cnic}</td>
                      <td className="py-2.5 pr-4">{ROLE_LABELS[u.role]}</td>
                      <td className="py-2.5 pr-4 text-ink-secondary">{u.airport}</td>
                      <td className="py-2.5 pr-4 text-ink-secondary">{u.shiftGroupName ? `Crew ${u.shiftGroupName}` : "—"}</td>
                      <td className="py-2.5 pr-4 capitalize">
                        <span className={u.status === "active" ? "text-status-active" : "text-status-critical"}>{u.status}</span>
                      </td>
                      <td className="py-2.5">
                        {(!isCfro || (u.airportId === myAirportId && CFRO_MANAGEABLE_ROLES.includes(u.role))) && (
                          <button onClick={() => setEditingUserId(u.id)} className="text-xs font-medium text-brand underline">
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </Card>

          {/* Phone screens: stacked cards */}
          <div className="space-y-3 sm:hidden">
            {users?.map((u) =>
              editingUserId === u.id ? (
                <Card key={u.id} className="border-brand/30">
                  <UserEditFields
                    user={u}
                    airports={airports}
                    isCfro={isCfro}
                    assignableRoles={assignableRoles}
                    onCancel={() => setEditingUserId(null)}
                    onSaved={() => {
                      setEditingUserId(null);
                      loadUsers();
                    }}
                  />
                </Card>
              ) : (
                <Card key={u.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink-primary">{u.fullName}</p>
                      <p className="font-mono text-xs text-ink-secondary">{u.cnic}</p>
                    </div>
                    <span
                      className={`shrink-0 text-xs font-medium capitalize ${u.status === "active" ? "text-status-active" : "text-status-critical"}`}
                    >
                      {u.status}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-ink-secondary">
                    <div>
                      <p className="text-xs text-ink-faint">Role</p>
                      <p>{ROLE_LABELS[u.role]}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ink-faint">Airport</p>
                      <p>{u.airport}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ink-faint">Crew</p>
                      <p>{u.shiftGroupName ? `Crew ${u.shiftGroupName}` : "—"}</p>
                    </div>
                  </div>
                  {(!isCfro || (u.airportId === myAirportId && CFRO_MANAGEABLE_ROLES.includes(u.role))) && (
                    <button
                      onClick={() => setEditingUserId(u.id)}
                      className="mt-3 text-xs font-medium text-brand underline"
                    >
                      Edit
                    </button>
                  )}
                </Card>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

function UserEditFields({
  user,
  airports,
  isCfro,
  assignableRoles,
  onCancel,
  onSaved,
}: {
  user: AdminUser;
  airports: Airport[];
  isCfro: boolean;
  assignableRoles: Role[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(user.fullName);
  const [roleName, setRoleName] = useState<Role>(user.role);
  const [airportId, setAirportId] = useState(user.airportId ?? "");
  const [shiftGroupId, setShiftGroupId] = useState(user.shiftGroupId ?? "");
  const [groups, setGroups] = useState<ShiftGroup[]>([]);
  const [status, setStatus] = useState<"active" | "suspended">(user.status as "active" | "suspended");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNational = NATIONAL_ROLES.includes(roleName);
  const isShiftGroupRole = SHIFT_GROUP_ROLES.includes(roleName);

  useEffect(() => {
    if (airportId && isShiftGroupRole) {
      api.shiftGroups(airportId).then(setGroups);
    } else {
      setGroups([]);
    }
  }, [airportId, isShiftGroupRole]);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Full name">
          <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Role">
          <select className={inputClass} value={roleName} onChange={(e) => setRoleName(e.target.value as Role)}>
            {assignableRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        {!isNational && (
          <Field label="Airport">
            {isCfro ? (
              <input className={inputClass} value={airports.find((a) => a.id === airportId)?.name ?? ""} disabled />
            ) : (
              <select className={inputClass} value={airportId} onChange={(e) => setAirportId(e.target.value)}>
                <option value="">Select…</option>
                {airports.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {isShiftGroupRole && airportId && (
          <Field label="Shift group">
            <select className={inputClass} value={shiftGroupId} onChange={(e) => setShiftGroupId(e.target.value)}>
              <option value="">None</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  Crew {g.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Status">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as "active" | "suspended")}>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </Field>
        <Field label="Reset password (optional)">
          <input
            className={inputClass}
            type="password"
            placeholder="Leave blank to keep current"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </Field>
      </div>
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          disabled={saving || !fullName || (!isNational && !airportId) || (newPassword.length > 0 && newPassword.length < 8)}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              await api.updateUser(user.id, {
                fullName,
                roleName,
                airportId: isNational ? null : airportId,
                shiftGroupId: isNational || !isShiftGroupRole ? null : shiftGroupId || null,
                status,
                newPassword: newPassword || undefined,
              });
              onSaved();
            } catch (err) {
              setError(err instanceof ApiRequestError ? err.message : "Failed to update user");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
