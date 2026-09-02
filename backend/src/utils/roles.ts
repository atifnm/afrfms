// Shared role-name groupings. Keeping these in one place avoids the
// SUPERINTENDENT/SUPERVISOR-style rank name drifting out of sync across
// route files as the org chart changes.
//
// Hierarchy (Architecture Doc extension):
//   GM_FIRE / ADMIN   — national, full access
//   CFRO              — command of one airport; appoints the Team Leader,
//                       all fire crew, and their shift assignments there
//   TEAM_LEADER       — shift-in-charge for a rotation crew (A/B/C/D)
//   SR_SUPDT, SUPDT,
//   SUPVR, ASSTT      — firefighter ranks, senior to junior, under a Team Leader
//   DRIVER            — Special Vehicle Driver
//   MECH_TECHNICIAN,
//   MECH_OFFICER      — vehicle maintenance staff

export const ROLE_ENUM = [
  "GM_FIRE",
  "ADMIN",
  "CFRO",
  "TEAM_LEADER",
  "SR_SUPDT",
  "SUPDT",
  "SUPVR",
  "ASSTT",
  "DRIVER",
  "MECH_TECHNICIAN",
  "MECH_OFFICER",
] as const;

export type RoleName = (typeof ROLE_ENUM)[number];

// National-scope roles: not tied to a single airport.
export const NATIONAL_ROLES = ["GM_FIRE", "ADMIN"] as const;

// The four firefighter ranks, senior to junior, that sit under a Team Leader.
export const FIREFIGHTER_RANKS = ["SR_SUPDT", "SUPDT", "SUPVR", "ASSTT"] as const;

// The two ranks that historically mapped to the single "SUPERINTENDENT" role
// — used wherever a shift assignment records who the superintendent-level
// person on duty for a vehicle was.
export const SUPERINTENDENT_RANKS = ["SR_SUPDT", "SUPDT"] as const;

// The rank that historically mapped to "SUPERVISOR".
export const SUPERVISOR_RANK = "SUPVR" as const;

// Roles that rotate through a named crew (A/B/C/D) at their airport.
export const SHIFT_GROUP_ROLES = ["TEAM_LEADER", "SR_SUPDT", "SUPDT", "SUPVR", "ASSTT", "DRIVER"] as const;

// Airport-scoped roles a CFRO is allowed to appoint/manage at their own
// airport: the Team Leader, all fire crew ranks, drivers, and the
// maintenance staff stationed there. A CFRO can never appoint another CFRO
// or a national-scope role (GM_FIRE, ADMIN) — only GM_FIRE/ADMIN can do that.
export const CFRO_MANAGEABLE_ROLES = [
  "TEAM_LEADER",
  "SR_SUPDT",
  "SUPDT",
  "SUPVR",
  "ASSTT",
  "DRIVER",
  "MECH_TECHNICIAN",
  "MECH_OFFICER",
] as const;
