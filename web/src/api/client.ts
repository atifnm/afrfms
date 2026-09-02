import type {
  LoginResponse,
  Me,
  Airport,
  Equipment,
  EquipmentCategory,
  Station,
  ShiftGroup,
  StaffRosterEntry,
  ChecklistTemplate,
  MyAssignmentSummary,
  MyAssignmentDetail,
  InspectionResponseInput,
  SubmitInspectionResult,
  ShiftSummary,
  ShiftLive,
  FaultSummary,
  FaultDetail,
  ShiftReport,
  AdminUser,
  Role,
} from "./types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let currentToken: string | null = null;
export function setToken(token: string | null) {
  currentToken = token;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (currentToken) headers["Authorization"] = `Bearer ${currentToken}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : undefined;

  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new ApiRequestError(message, res.status);
  }
  return body as T;
}

export const api = {
  // Auth
  login: (cnic: string, password: string) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify({ cnic, password }) }),
  me: () => request<Me>("/auth/me"),

  // Airports
  airports: () => request<Airport[]>("/airports"),
  createAirport: (body: { name: string; icaoCode: string; region: string; shiftPattern?: "2_shift" | "3_shift" }) =>
    request<Airport>("/airports", { method: "POST", body: JSON.stringify(body) }),
  updateAirport: (airportId: string, body: { name?: string; icaoCode?: string; region?: string }) =>
    request<{ ok: true }>(`/airports/${airportId}`, { method: "PATCH", body: JSON.stringify(body) }),
  updateAirportShiftPattern: (airportId: string, shiftPattern: "2_shift" | "3_shift") =>
    request<{ ok: true; shiftPattern: "2_shift" | "3_shift" }>(`/airports/${airportId}/shift-pattern`, {
      method: "PATCH",
      body: JSON.stringify({ shiftPattern }),
    }),
  drivers: (airportId: string) => request<{ id: string; fullName: string }[]>(`/airports/${airportId}/drivers`),
  stations: (airportId: string) => request<Station[]>(`/airports/${airportId}/stations`),
  createStation: (airportId: string, name: string) =>
    request<Station>(`/airports/${airportId}/stations`, { method: "POST", body: JSON.stringify({ name }) }),
  shiftEligibleStaff: (airportId: string) => request<StaffRosterEntry[]>(`/airports/${airportId}/shift-eligible-staff`),

  // Equipment
  equipment: (airportId: string) => request<Equipment[]>(`/airports/${airportId}/equipment`),
  createEquipment: (
    airportId: string,
    body: { regNo: string; categoryId: string; make?: string; model?: string; year?: number; stationId?: string; currentOdometer?: number }
  ) => request<{ id: string }>(`/airports/${airportId}/equipment`, { method: "POST", body: JSON.stringify(body) }),
  updateEquipment: (
    airportId: string,
    equipmentId: string,
    body: Partial<{
      regNo: string;
      make: string | null;
      model: string | null;
      year: number | null;
      categoryId: string;
      stationId: string | null;
      status: string;
    }>
  ) => request<{ ok: true }>(`/airports/${airportId}/equipment/${equipmentId}`, { method: "PATCH", body: JSON.stringify(body) }),
  retireEquipment: (airportId: string, equipmentId: string) =>
    request<{ ok: true; status: string }>(`/airports/${airportId}/equipment/${equipmentId}`, { method: "DELETE" }),

  // Checklists / Categories
  categories: () => request<EquipmentCategory[]>("/categories"),
  createCategory: (name: string) => request<EquipmentCategory>("/categories", { method: "POST", body: JSON.stringify({ name }) }),
  renameCategory: (categoryId: string, name: string) =>
    request<{ ok: true }>(`/categories/${categoryId}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  checklistTemplate: (categoryId: string) => request<ChecklistTemplate>(`/categories/${categoryId}/checklist-template`),
  updateChecklistTemplate: (
    categoryId: string,
    items: { id?: string; section: string; label: string; inputType: string; isCritical: boolean }[]
  ) =>
    request<{ ok: true; templateId: string }>(`/categories/${categoryId}/checklist-template`, {
      method: "PATCH",
      body: JSON.stringify({ items }),
    }),

  // Shift groups (rotation crews A/B/C/D)
  shiftGroups: (airportId: string) => request<ShiftGroup[]>(`/airports/${airportId}/shift-groups`),
  createShiftGroup: (airportId: string, name: string) =>
    request<ShiftGroup>(`/airports/${airportId}/shift-groups`, { method: "POST", body: JSON.stringify({ name }) }),
  updateShiftGroup: (airportId: string, groupId: string, body: { name: string }) =>
    request<{ ok: true }>(`/airports/${airportId}/shift-groups/${groupId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteShiftGroup: (airportId: string, groupId: string) =>
    request<{ ok: true }>(`/airports/${airportId}/shift-groups/${groupId}`, { method: "DELETE" }),
  assignToShiftGroup: (airportId: string, groupId: string, userId: string) =>
    request<{ ok: true }>(`/airports/${airportId}/shift-groups/${groupId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),
  removeFromShiftGroup: (airportId: string, groupId: string, userId: string) =>
    request<{ ok: true }>(`/airports/${airportId}/shift-groups/${groupId}/members/${userId}`, { method: "DELETE" }),

  // Shifts
  listShifts: (airportId: string, date?: string) =>
    request<ShiftSummary[]>(`/airports/${airportId}/shifts${date ? `?date=${date}` : ""}`),
  createShift: (airportId: string, body: { shiftDate: string; shiftType: string; shiftGroupId: string; stationId?: string }) =>
    request<{ id: string }>(`/airports/${airportId}/shifts`, { method: "POST", body: JSON.stringify(body) }),
  shiftLive: (airportId: string, shiftId: string) => request<ShiftLive>(`/airports/${airportId}/shifts/${shiftId}`),
  assignVehicle: (
    airportId: string,
    shiftId: string,
    body: { equipmentId: string; driverId: string; supervisorId?: string; superintendentId?: string }
  ) =>
    request<{ id: string }>(`/airports/${airportId}/shifts/${shiftId}/assignments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAssignment: (
    airportId: string,
    shiftId: string,
    assignmentId: string,
    body: Partial<{ driverId: string; supervisorId: string | null; superintendentId: string | null }>
  ) =>
    request<{ ok: true }>(`/airports/${airportId}/shifts/${shiftId}/assignments/${assignmentId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  markException: (airportId: string, shiftId: string, assignmentId: string, reason: string) =>
    request<{ ok: true }>(`/airports/${airportId}/shifts/${shiftId}/assignments/${assignmentId}/exception`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  generateReport: (airportId: string, shiftId: string, summary?: string) =>
    request<ShiftReport>(`/airports/${airportId}/shifts/${shiftId}/report`, {
      method: "POST",
      body: JSON.stringify({ summary }),
    }),
  getReport: (airportId: string, shiftId: string) =>
    request<ShiftReport>(`/airports/${airportId}/shifts/${shiftId}/report`),
  // PDF is a binary response needing the auth header, so it can't just be a
  // plain <a href>. Fetches the blob and triggers a browser download.
  downloadReportPdf: async (airportId: string, shiftId: string, filename: string) => {
    const res = await fetch(`${API_URL}/airports/${airportId}/shifts/${shiftId}/report/pdf`, {
      headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      throw new ApiRequestError(body?.error ?? `Request failed (${res.status})`, res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // Driver — a driver may have more than one vehicle assigned in a shift,
  // so these operate on ONE assignment at a time, identified explicitly.
  todayForMe: () => request<ShiftSummary[]>(`/shifts/today-for-me`),
  myAssignments: (shiftId: string) => request<MyAssignmentSummary[]>(`/shifts/${shiftId}/my-assignments`),
  myAssignmentDetail: (shiftId: string, assignmentId: string) =>
    request<MyAssignmentDetail>(`/shifts/${shiftId}/my-assignments/${assignmentId}`),
  submitInspection: (shiftId: string, assignmentId: string, odometerReading: number, responses: InspectionResponseInput[]) =>
    request<SubmitInspectionResult>(`/shifts/${shiftId}/my-assignments/${assignmentId}/inspection`, {
      method: "POST",
      body: JSON.stringify({ odometerReading, responses }),
    }),

  // Faults
  faultsForAirport: (airportId: string, filters?: { status?: string; severity?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.severity) params.set("severity", filters.severity);
    const qs = params.toString();
    return request<FaultSummary[]>(`/airports/${airportId}/faults${qs ? `?${qs}` : ""}`);
  },
  faultDetail: (faultId: string) => request<FaultDetail>(`/faults/${faultId}`),
  acknowledgeFault: (faultId: string) => request<{ ok: true; faultStatus: string }>(`/faults/${faultId}/acknowledge`, { method: "POST" }),
  addFaultLog: (faultId: string, note: string) =>
    request<{ id: string }>(`/faults/${faultId}/logs`, { method: "POST", body: JSON.stringify({ note }) }),
  resolveFault: (faultId: string, resolutionNotes: string) =>
    request<{ ok: true; equipmentReactivated: boolean }>(`/faults/${faultId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolutionNotes }),
    }),
  escalateFault: (faultId: string, reason: string) =>
    request<{ ok: true; notified: number }>(`/faults/${faultId}/escalate`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  // Users (Admin)
  listUsers: () => request<AdminUser[]>("/users"),
  createUser: (body: {
    fullName: string;
    cnic: string;
    phone?: string;
    password: string;
    roleName: Role;
    airportId?: string;
    shiftGroupId?: string;
  }) => request<{ id: string }>("/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (
    userId: string,
    body: Partial<{
      fullName: string;
      roleName: Role;
      airportId: string | null;
      shiftGroupId: string | null;
      status: "active" | "suspended";
      newPassword: string;
    }>
  ) => request<{ ok: true }>(`/users/${userId}`, { method: "PATCH", body: JSON.stringify(body) }),
};
