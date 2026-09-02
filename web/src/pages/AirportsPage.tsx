import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import { api, ApiRequestError } from "../api/client";
import type { Airport, Equipment, EquipmentCategory, Station, EquipmentStatus } from "../api/types";
import { StatusBeacon, equipmentStatusTone } from "../components/StatusBeacon";
import { Button, Card, EmptyState, ErrorBanner, Field, LoadingSpinner, PageHeader, inputClass } from "../components/ui";

const STATUSES: EquipmentStatus[] = ["active", "grounded", "under_maintenance", "retired"];

export function AirportsPage() {
  const { user } = useAuth();
  const canManage = user?.role === "SR_SUPDT" || user?.role === "SUPDT" || user?.role === "ADMIN" || user?.role === "GM_FIRE";
  const canManageAirports = user?.role === "ADMIN" || user?.role === "GM_FIRE";
  const canTogglePattern = canManageAirports || user?.role === "CFRO";
  const canManageStations = user?.role === "CFRO" || user?.role === "ADMIN" || user?.role === "GM_FIRE";
  const needsStations = canManage || canManageStations;

  const [airports, setAirports] = useState<Airport[] | null>(null);
  const [selected, setSelected] = useState<Airport | null>(null);
  const [equipment, setEquipment] = useState<Equipment[] | null>(null);
  const [categories, setCategories] = useState<EquipmentCategory[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(false);

  const [showNewAirport, setShowNewAirport] = useState(false);
  const [showNewEquipment, setShowNewEquipment] = useState(false);
  const [showNewStation, setShowNewStation] = useState(false);
  const [editingAirport, setEditingAirport] = useState(false);
  const [editingEquipmentId, setEditingEquipmentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshAirports = useCallback(async () => {
    const list = await api.airports();
    setAirports(list);
    return list;
  }, []);

  useEffect(() => {
    refreshAirports().then((list) => {
      if (list.length === 1) setSelected(list[0]);
    });
    if (canManage) api.categories().then(setCategories);
  }, [refreshAirports, canManage]);

  const refreshEquipment = useCallback(
    async (airportId: string) => {
      setLoadingEquipment(true);
      try {
        const [eq, st] = await Promise.all([api.equipment(airportId), needsStations ? api.stations(airportId) : Promise.resolve([])]);
        setEquipment(eq);
        setStations(st);
      } finally {
        setLoadingEquipment(false);
      }
    },
    [needsStations]
  );

  useEffect(() => {
    if (!selected) return;
    refreshEquipment(selected.id);
  }, [selected, refreshEquipment]);

  if (!airports) return <LoadingSpinner />;

  return (
    <div>
      <PageHeader
        title="Airports & Fleet"
        action={
          canManageAirports ? (
            <Button onClick={() => setShowNewAirport((v) => !v)}>{showNewAirport ? "Cancel" : "New airport"}</Button>
          ) : undefined
        }
      />

      {actionError && (
        <div className="mb-4">
          <ErrorBanner message={actionError} />
        </div>
      )}

      {showNewAirport && (
        <NewAirportForm
          onCancel={() => setShowNewAirport(false)}
          onCreated={async () => {
            setShowNewAirport(false);
            await refreshAirports();
          }}
          onError={setActionError}
        />
      )}

      {airports.length > 1 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {airports.map((a) => (
            <button key={a.id} onClick={() => setSelected(a)} className="text-left">
              <Card className={`transition-shadow hover:shadow-md ${selected?.id === a.id ? "border-brand" : ""}`}>
                <p className="font-display font-semibold text-ink-primary">{a.name}</p>
                <p className="text-xs text-ink-faint">
                  {a.icaoCode} · {a.region}
                </p>
                <p className="mt-2 text-sm text-ink-secondary">{a.equipmentCount} vehicles</p>
              </Card>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-display text-sm font-semibold text-ink-primary">{selected.name} — Fleet</p>
              <p className="text-xs text-ink-faint">
                Shift pattern: {selected.shiftPattern === "2_shift" ? "2 shifts · morning/night (12hr)" : "3 shifts · morning/evening/night (8hr)"}
              </p>
            </div>
            <div className="flex gap-2">
              {canTogglePattern && <ShiftPatternToggle airport={selected} onChanged={async (updated) => {
                const list = await refreshAirports();
                setSelected(list.find((a) => a.id === updated.id) ?? updated);
              }} onError={setActionError} />}
              {canManageAirports && (
                <button onClick={() => setEditingAirport((v) => !v)} className="text-xs font-medium text-brand underline">
                  {editingAirport ? "Cancel" : "Edit airport"}
                </button>
              )}
              {canManageStations && (
                <button onClick={() => setShowNewStation((v) => !v)} className="text-xs font-medium text-brand underline">
                  {showNewStation ? "Cancel" : "New station"}
                </button>
              )}
              {canManage && (
                <Button onClick={() => setShowNewEquipment((v) => !v)} className="text-xs">
                  {showNewEquipment ? "Cancel" : "New vehicle"}
                </Button>
              )}
            </div>
          </div>

          {needsStations && stations.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {stations.map((s) => (
                <span key={s.id} className="rounded-full border border-surface-hairline px-2.5 py-1 text-xs text-ink-secondary">
                  {s.name}
                </span>
              ))}
            </div>
          )}

          {showNewStation && (
            <NewStationForm
              airportId={selected.id}
              existingStations={stations}
              onCancel={() => setShowNewStation(false)}
              onCreated={async () => {
                setShowNewStation(false);
                await refreshEquipment(selected.id);
              }}
              onError={setActionError}
            />
          )}

          {editingAirport && (
            <EditAirportForm
              airport={selected}
              onCancel={() => setEditingAirport(false)}
              onSaved={async (updated) => {
                setEditingAirport(false);
                const list = await refreshAirports();
                setSelected(list.find((a) => a.id === updated.id) ?? updated);
              }}
              onError={setActionError}
            />
          )}

          {showNewEquipment && (
            <NewEquipmentForm
              airportId={selected.id}
              categories={categories}
              stations={stations}
              onCancel={() => setShowNewEquipment(false)}
              onCreated={async () => {
                setShowNewEquipment(false);
                await refreshEquipment(selected.id);
                await refreshAirports();
              }}
              onError={setActionError}
            />
          )}

          {loadingEquipment ? (
            <LoadingSpinner />
          ) : !equipment || equipment.length === 0 ? (
            <EmptyState title="No equipment registered yet" />
          ) : (
            <>
              {/* Desktop / wide screens: table */}
              <Card className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-surface-hairline text-left text-xs uppercase tracking-wide text-ink-faint">
                      <th className="pb-2 pr-4">Vehicle</th>
                      <th className="pb-2 pr-4">Category</th>
                      <th className="pb-2 pr-4">Station</th>
                      <th className="pb-2 pr-4">Odometer</th>
                      <th className="pb-2 pr-4">Status</th>
                      {canManage && <th className="pb-2">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {equipment.map((e) =>
                      editingEquipmentId === e.id ? (
                        <tr key={e.id} className="border-b border-surface-hairline bg-surface/60">
                          <td colSpan={canManage ? 6 : 5} className="py-3">
                            <EquipmentEditFields
                              equipment={e}
                              airportId={selected.id}
                              categories={categories}
                              stations={stations}
                              onCancel={() => setEditingEquipmentId(null)}
                              onSaved={async () => {
                                setEditingEquipmentId(null);
                                await refreshEquipment(selected.id);
                              }}
                              onError={setActionError}
                            />
                          </td>
                        </tr>
                      ) : (
                        <tr key={e.id} className="border-b border-surface-hairline last:border-0">
                          <td className="py-2.5 pr-4 font-mono font-medium">{e.regNo}</td>
                          <td className="py-2.5 pr-4">{e.category}</td>
                          <td className="py-2.5 pr-4 text-ink-secondary">{e.station ?? "—"}</td>
                          <td className="py-2.5 pr-4 font-mono text-ink-secondary">{e.currentOdometer.toLocaleString()} km</td>
                          <td className="py-2.5 pr-4">
                            <StatusBeacon tone={equipmentStatusTone(e.status)} label={e.status.replace("_", " ")} />
                          </td>
                          {canManage && (
                            <td className="py-2.5">
                              <div className="flex gap-3">
                                <button onClick={() => setEditingEquipmentId(e.id)} className="text-xs font-medium text-brand underline">
                                  Edit
                                </button>
                                {e.status !== "retired" && (
                                  <button
                                    onClick={async () => {
                                      if (!window.confirm(`Retire ${e.regNo}? It will no longer be assignable to shifts.`)) return;
                                      try {
                                        await api.retireEquipment(selected.id, e.id);
                                        await refreshEquipment(selected.id);
                                      } catch (err) {
                                        setActionError(err instanceof ApiRequestError ? err.message : "Failed to retire vehicle");
                                      }
                                    }}
                                    className="text-xs font-medium text-status-critical underline"
                                  >
                                    Retire
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </Card>

              {/* Phone screens: stacked cards */}
              <div className="space-y-3 sm:hidden">
                {equipment.map((e) =>
                  editingEquipmentId === e.id ? (
                    <Card key={e.id} className="border-brand/30">
                      <EquipmentEditFields
                        equipment={e}
                        airportId={selected.id}
                        categories={categories}
                        stations={stations}
                        onCancel={() => setEditingEquipmentId(null)}
                        onSaved={async () => {
                          setEditingEquipmentId(null);
                          await refreshEquipment(selected.id);
                        }}
                        onError={setActionError}
                      />
                    </Card>
                  ) : (
                    <Card key={e.id}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-mono font-semibold text-ink-primary">{e.regNo}</p>
                        <StatusBeacon tone={equipmentStatusTone(e.status)} label={e.status.replace("_", " ")} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-ink-secondary">
                        <div>
                          <p className="text-xs text-ink-faint">Category</p>
                          <p>{e.category}</p>
                        </div>
                        <div>
                          <p className="text-xs text-ink-faint">Station</p>
                          <p>{e.station ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-ink-faint">Odometer</p>
                          <p className="font-mono">{e.currentOdometer.toLocaleString()} km</p>
                        </div>
                      </div>
                      {canManage && (
                        <div className="mt-3 flex gap-3">
                          <button onClick={() => setEditingEquipmentId(e.id)} className="text-xs font-medium text-brand underline">
                            Edit
                          </button>
                          {e.status !== "retired" && (
                            <button
                              onClick={async () => {
                                if (!window.confirm(`Retire ${e.regNo}? It will no longer be assignable to shifts.`)) return;
                                try {
                                  await api.retireEquipment(selected.id, e.id);
                                  await refreshEquipment(selected.id);
                                } catch (err) {
                                  setActionError(err instanceof ApiRequestError ? err.message : "Failed to retire vehicle");
                                }
                              }}
                              className="text-xs font-medium text-status-critical underline"
                            >
                              Retire
                            </button>
                          )}
                        </div>
                      )}
                    </Card>
                  )
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NewAirportForm({
  onCancel,
  onCreated,
  onError,
}: {
  onCancel: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [icaoCode, setIcaoCode] = useState("");
  const [region, setRegion] = useState("");
  const [shiftPattern, setShiftPattern] = useState<"2_shift" | "3_shift">("3_shift");
  const [saving, setSaving] = useState(false);

  return (
    <Card className="mb-6">
      <p className="mb-3 font-display text-sm font-semibold text-ink-primary">New airport</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="ICAO code">
          <input className={inputClass} value={icaoCode} onChange={(e) => setIcaoCode(e.target.value.toUpperCase())} maxLength={4} />
        </Field>
        <Field label="Region">
          <input className={inputClass} value={region} onChange={(e) => setRegion(e.target.value)} />
        </Field>
        <Field label="Shift pattern">
          <select className={inputClass} value={shiftPattern} onChange={(e) => setShiftPattern(e.target.value as "2_shift" | "3_shift")}>
            <option value="3_shift">3 shifts · morning/evening/night (8hr)</option>
            <option value="2_shift">2 shifts · morning/night (12hr)</option>
          </select>
        </Field>
        <Button
          disabled={saving || !name || icaoCode.length < 3 || !region}
          onClick={async () => {
            setSaving(true);
            try {
              await api.createAirport({ name, icaoCode, region, shiftPattern });
              onCreated();
            } catch (err) {
              onError(err instanceof ApiRequestError ? err.message : "Failed to create airport");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Creating…" : "Create"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function ShiftPatternToggle({
  airport,
  onChanged,
  onError,
}: {
  airport: Airport;
  onChanged: (updated: Airport) => void;
  onError: (msg: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const nextPattern: "2_shift" | "3_shift" = airport.shiftPattern === "2_shift" ? "3_shift" : "2_shift";

  return (
    <button
      disabled={saving}
      className="text-xs font-medium text-brand underline disabled:opacity-50"
      onClick={async () => {
        const label = nextPattern === "2_shift" ? "2 shifts (morning/night, 12hr)" : "3 shifts (morning/evening/night, 8hr)";
        if (!window.confirm(`Switch ${airport.name} to ${label}? Any open shift on a shift type the new pattern doesn't support must have its report issued first.`)) return;
        setSaving(true);
        try {
          await api.updateAirportShiftPattern(airport.id, nextPattern);
          onChanged({ ...airport, shiftPattern: nextPattern });
        } catch (err) {
          onError(err instanceof ApiRequestError ? err.message : "Failed to update shift pattern");
        } finally {
          setSaving(false);
        }
      }}
    >
      {saving ? "Switching…" : `Switch to ${nextPattern === "2_shift" ? "2-shift" : "3-shift"}`}
    </button>
  );
}

function EditAirportForm({
  airport,
  onCancel,
  onSaved,
  onError,
}: {
  airport: Airport;
  onCancel: () => void;
  onSaved: (updated: Airport) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(airport.name);
  const [icaoCode, setIcaoCode] = useState(airport.icaoCode);
  const [region, setRegion] = useState(airport.region);
  const [saving, setSaving] = useState(false);

  return (
    <Card className="mb-4">
      <p className="mb-3 font-display text-sm font-semibold text-ink-primary">Edit airport</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="ICAO code">
          <input className={inputClass} value={icaoCode} onChange={(e) => setIcaoCode(e.target.value.toUpperCase())} maxLength={4} />
        </Field>
        <Field label="Region">
          <input className={inputClass} value={region} onChange={(e) => setRegion(e.target.value)} />
        </Field>
        <Button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await api.updateAirport(airport.id, { name, icaoCode, region });
              onSaved({ ...airport, name, icaoCode, region });
            } catch (err) {
              onError(err instanceof ApiRequestError ? err.message : "Failed to update airport");
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
    </Card>
  );
}

function NewStationForm({
  airportId,
  existingStations,
  onCancel,
  onCreated,
  onError,
}: {
  airportId: string;
  existingStations: Station[];
  onCancel: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <Card className="mb-4">
      <p className="mb-3 font-display text-sm font-semibold text-ink-primary">New station</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Fire Depot" />
        </Field>
        <Button
          disabled={saving || !name.trim()}
          onClick={async () => {
            if (existingStations.some((s) => s.name.toLowerCase() === name.trim().toLowerCase())) {
              onError("A station with this name already exists at this airport");
              return;
            }
            setSaving(true);
            try {
              await api.createStation(airportId, name.trim());
              setName("");
              onCreated();
            } catch (err) {
              onError(err instanceof ApiRequestError ? err.message : "Failed to create station");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Creating…" : "Create"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function NewEquipmentForm({
  airportId,
  categories,
  stations,
  onCancel,
  onCreated,
  onError,
}: {
  airportId: string;
  categories: EquipmentCategory[];
  stations: Station[];
  onCancel: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [regNo, setRegNo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [stationId, setStationId] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <Card className="mb-4">
      <p className="mb-3 font-display text-sm font-semibold text-ink-primary">New vehicle</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Registration No.">
          <input className={inputClass} value={regNo} onChange={(e) => setRegNo(e.target.value)} />
        </Field>
        <Field label="Category">
          <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Make">
          <input className={inputClass} value={make} onChange={(e) => setMake(e.target.value)} />
        </Field>
        <Field label="Model">
          <input className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field label="Station (optional)">
          <select className={inputClass} value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">None</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          disabled={saving || !regNo || !categoryId}
          onClick={async () => {
            setSaving(true);
            try {
              await api.createEquipment(airportId, {
                regNo,
                categoryId,
                make: make || undefined,
                model: model || undefined,
                stationId: stationId || undefined,
              });
              onCreated();
            } catch (err) {
              onError(err instanceof ApiRequestError ? err.message : "Failed to create vehicle");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Creating…" : "Create"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function EquipmentEditFields({
  equipment,
  airportId,
  categories,
  stations,
  onCancel,
  onSaved,
  onError,
}: {
  equipment: Equipment;
  airportId: string;
  categories: EquipmentCategory[];
  stations: Station[];
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [regNo, setRegNo] = useState(equipment.regNo);
  const [categoryId, setCategoryId] = useState(equipment.categoryId);
  const [stationId, setStationId] = useState(equipment.stationId ?? "");
  const [status, setStatus] = useState<EquipmentStatus>(equipment.status);
  const [saving, setSaving] = useState(false);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Vehicle">
          <input className={inputClass} value={regNo} onChange={(e) => setRegNo(e.target.value)} />
        </Field>
        <Field label="Category">
          <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Station">
          <select className={inputClass} value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">None</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Odometer">
          <p className={`${inputClass} font-mono text-ink-secondary`}>{equipment.currentOdometer.toLocaleString()} km</p>
        </Field>
        <Field label="Status">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as EquipmentStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await api.updateEquipment(airportId, equipment.id, {
                regNo,
                categoryId,
                stationId: stationId || null,
                status,
              });
              onSaved();
            } catch (err) {
              onError(err instanceof ApiRequestError ? err.message : "Failed to update vehicle");
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
