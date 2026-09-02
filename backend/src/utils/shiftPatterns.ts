// An airport runs either three 8-hour shifts (morning/evening/night) or two
// 12-hour shifts (morning/night), set per-airport by CFRO/Admin/GM_FIRE (see
// airports.routes.ts PATCH /:airportId/shift-pattern). Shift creation and
// shift-group "current shift type" assignment both need to validate against
// whichever pattern the airport is actually running.

export type ShiftPattern = "2_shift" | "3_shift";
export type ShiftType = "morning" | "evening" | "night";

export const SHIFT_PATTERNS: readonly ShiftPattern[] = ["2_shift", "3_shift"];

export const SHIFT_TYPES_BY_PATTERN: Record<ShiftPattern, readonly ShiftType[]> = {
  "3_shift": ["morning", "evening", "night"],
  "2_shift": ["morning", "night"],
};

export function isShiftTypeValidForPattern(shiftType: string, pattern: ShiftPattern): boolean {
  return (SHIFT_TYPES_BY_PATTERN[pattern] as readonly string[]).includes(shiftType);
}
