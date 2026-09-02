export type Role =
  | "GM_FIRE"
  | "CFRO"
  | "SR_SUPDT"
  | "SUPDT"
  | "SUPVR"
  | "ASSTT"
  | "TEAM_LEADER"
  | "DRIVER"
  | "MECH_TECHNICIAN"
  | "MECH_OFFICER"
  | "ADMIN";

export const ROLE_LABELS: Record<Role, string> = {
  GM_FIRE: "GM Fire",
  CFRO: "CFRO",
  TEAM_LEADER: "Team Leader",
  SR_SUPDT: "Sr Supdt",
  SUPDT: "Supdt",
  SUPVR: "Supvr",
  ASSTT: "Asstt",
  DRIVER: "Driver",
  MECH_TECHNICIAN: "Mechanical Technician",
  MECH_OFFICER: "Mechanical Officer",
  ADMIN: "Admin",
};

export interface AirportRef {
  id: string;
  name: string;
}

export interface AuthUser {
  id: string;
  fullName: string;
  role: Role;
  airport: AirportRef | null;
}

export interface Me extends AuthUser {
  cnic: string;
  isNational: boolean;
  lastLoginAt: string | null;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export type ShiftPattern = "2_shift" | "3_shift";

export interface Airport {
  id: string;
  name: string;
  icaoCode: string;
  region: string;
  shiftPattern: ShiftPattern;
  stationCount: number;
  equipmentCount: number;
}

export type EquipmentStatus = "active" | "grounded" | "under_maintenance" | "retired";

export interface Equipment {
  id: string;
  regNo: string;
  make: string | null;
  model: string | null;
  year: number | null;
  category: string;
  categoryId: string;
  station: string | null;
  stationId: string | null;
  status: EquipmentStatus;
  currentOdometer: number;
}

export interface EquipmentCategory {
  id: string;
  name: string;
}

export interface Station {
  id: string;
  name: string;
}

export type InputType = "boolean" | "numeric" | "text";

export interface ChecklistItem {
  id: string;
  section: string;
  label: string;
  inputType: InputType;
  isCritical: boolean;
}

export interface ChecklistTemplate {
  templateId: string;
  version: number;
  items: ChecklistItem[];
}

// A driver's assignment as it appears in the list of everything assigned to
// them for a shift (they may have more than one vehicle).
export interface MyAssignmentSummary {
  assignmentId: string;
  status: string;
  alreadySubmitted: boolean;
  equipment: { id: string; regNo: string; currentOdometer: number };
}

// The detail view for ONE specific assignment, including its checklist.
export interface MyAssignmentDetail {
  assignmentId: string;
  alreadySubmitted: boolean;
  equipment: { id: string; regNo: string; currentOdometer: number };
  checklist: ChecklistTemplate;
}

export interface InspectionResponseInput {
  checklistItemId: string;
  value: string;
  remarks?: string;
  photoUrl?: string;
}

export interface SubmitInspectionResult {
  submissionId: string;
  equipmentGrounded: boolean;
  faultsCreated: { id: string; label: string; severity: "minor" | "critical"; alertsSent: number }[];
}

export interface ShiftSummary {
  id: string;
  shiftDate: string;
  shiftType: "morning" | "evening" | "night";
  shiftGroupId: string | null;
  shiftGroupName: string | null;
}

export type AssignmentStatus = "pending" | "completed" | "exception";

export interface ShiftAssignmentLive {
  assignmentId: string;
  status: AssignmentStatus;
  equipment: { id: string; regNo: string; status: EquipmentStatus };
  driver: { id: string; name: string };
  supervisor: { id: string; name: string } | null;
  superintendent: { id: string; name: string } | null;
  submission: { id: string; odometerReading: number; submittedAt: string } | null;
}

export interface ShiftLive {
  id: string;
  shiftDate: string;
  shiftType: "morning" | "evening" | "night";
  shiftGroupId: string | null;
  shiftGroupName: string | null;
  assignments: ShiftAssignmentLive[];
}

export type FaultSeverity = "minor" | "critical";
export type FaultStatus = "open" | "in_progress" | "resolved";

export interface FaultSummary {
  id: string;
  description: string;
  severity: FaultSeverity;
  status: FaultStatus;
  equipment: { id: string; regNo: string };
  reportedAt: string;
  resolvedAt: string | null;
  isOverdue: boolean;
}

export interface FaultAlert {
  id: string;
  recipient: string;
  role: string;
  channel: string;
  sentAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface FaultLog {
  id: string;
  note: string;
  author: string;
  role: string;
  createdAt: string;
}

export interface FaultDetail {
  id: string;
  description: string;
  severity: FaultSeverity;
  status: FaultStatus;
  equipment: { id: string; regNo: string };
  reportedAt: string;
  resolvedAt: string | null;
  alerts: FaultAlert[];
  logs: FaultLog[];
}

export interface ShiftReportEquipmentEntry {
  equipmentId: string;
  regNo: string;
  category: string;
  equipmentStatus: EquipmentStatus;
  shiftStatus: "completed" | "exception" | "not_assigned";
  exceptionReason: string | null;
  checkedBy: string | null;
  supervisorOnDuty: string | null;
  superintendentOnDuty: string | null;
  previousOdometer: number | null;
  currentOdometer: number;
  faults: { description: string; severity: FaultSeverity; status: string; rectified: boolean }[];
}

export interface ShiftReport {
  id: string;
  generatedBy: string;
  generatedAt: string;
  summary: string | null;
  fleetHealthScore: number;
  vehiclesInspected: number;
  vehiclesException: number;
  faultsRaisedCritical: number;
  faultsRaisedMinor: number;
  faultsResolved: number;
  currentShiftLeaderName: string | null;
  previousShiftLeaderName: string | null;
  equipment: ShiftReportEquipmentEntry[];
}

export interface ShiftGroup {
  id: string;
  name: string;
  memberCounts: { teamLeaders: number; srSupdts: number; supdts: number; supvrs: number; asstts: number; drivers: number };
}

export interface StaffRosterEntry {
  id: string;
  fullName: string;
  role: Role;
  shiftGroupId: string | null;
  shiftGroupName: string | null;
}

export interface AdminUser {
  id: string;
  fullName: string;
  cnic: string;
  role: Role;
  airportId: string | null;
  airport: string;
  shiftGroupId: string | null;
  shiftGroupName: string | null;
  status: string;
  lastLoginAt: string | null;
}

export interface ApiError {
  error: string;
}
