// Integration test: mirrors src/api/client.ts's request() logic exactly and
// walks through every page's data flow, against a live backend. This is a
// stand-in for browser e2e testing (no headless browser available here) —
// it proves the frontend's exact fetch calls and response-shape assumptions
// match what the backend actually returns.
const API_URL = "http://localhost:4000";
let token = null;

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : undefined;
  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new Error(`${options.method || "GET"} ${path} -> ${res.status}: ${message}`);
  }
  return body;
}

let passed = 0;
async function check(label, fn) {
  try {
    await fn();
    passed++;
    console.log(`OK   ${label}`);
  } catch (err) {
    console.error(`FAIL ${label}\n     ${err.message}`);
    process.exitCode = 1;
  }
}

async function loginAs(cnic) {
  const res = await request("/auth/login", { method: "POST", body: JSON.stringify({ cnic, password: "Passw0rd!123" }) });
  token = res.token;
  return res.user;
}

const CNIC = {
  gmFire: "10000-0000009-9",
  cfro: "10000-0000001-1",
  srSupdt: "10000-0000002-2",
  supdt: "10000-0000010-0",
  supvr: "10000-0000003-3",
  asstt: "10000-0000011-1",
  teamLeader: "10000-0000004-4",
  driver: "10000-0000005-5",
  technician: "10000-0000006-6",
  officer: "10000-0000007-7",
  admin: "10000-0000008-8",
};

let airportId, shiftId, faultId, ambCategoryId, jeepCategoryId, newEquipmentId;

await check("Team Leader login + /auth/me", async () => {
  const user = await loginAs(CNIC.teamLeader);
  if (user.role !== "TEAM_LEADER") throw new Error("wrong role returned");
  const me = await request("/auth/me");
  if (!me.airport?.id) throw new Error("expected airport on scoped user");
  airportId = me.airport.id;
});

await check("ShiftsPage: airports() + listShifts()", async () => {
  const airports = await request("/airports");
  if (!Array.isArray(airports) || airports.length === 0) throw new Error("no airports");
  const shifts = await request(`/airports/${airportId}/shifts`);
  if (!Array.isArray(shifts) || shifts.length === 0) throw new Error("expected seeded demo shift");
  shiftId = shifts[0].id;
});

await check("ShiftDetailPage: shiftLive() + equipment() + drivers()", async () => {
  const live = await request(`/airports/${airportId}/shifts/${shiftId}`);
  if (!Array.isArray(live.assignments) || live.assignments.length !== 2) throw new Error("expected 2 seeded assignments");

  const equipment = await request(`/airports/${airportId}/equipment`);
  if (!equipment.some((e) => e.regNo === "FCT-001")) throw new Error("equipment list missing FCT-001");

  const drivers = await request(`/airports/${airportId}/drivers`);
  if (!Array.isArray(drivers) || drivers.length === 0) throw new Error("expected at least one driver");
});

await check("ShiftDetailPage: generateReport blocked while assignments pending (400)", async () => {
  try {
    await request(`/airports/${airportId}/shifts/${shiftId}/report`, { method: "POST", body: JSON.stringify({}) });
    throw new Error("expected 400, got success");
  } catch (err) {
    if (!err.message.includes("400")) throw err;
  }
});

// --- Regression test: a Team Leader loading ShiftDetailPage got a bare
// "Forbidden" screen because GET /shift-eligible-staff (used to populate the
// Supvr/Sr Supdt/Supdt picker) didn't allow the TEAM_LEADER role, even
// though ShiftDetailPage calls it whenever canManage is true for a Team
// Leader. This proves every call that page makes succeeds for a Team Leader.
await check("Team Leader: full ShiftDetailPage load succeeds (regression — was 403 on shift-eligible-staff)", async () => {
  await loginAs(CNIC.teamLeader);
  const live = await request(`/airports/${airportId}/shifts/${shiftId}`);
  if (live.id !== shiftId) throw new Error("Team Leader could not load shift detail");
  await request(`/airports/${airportId}/equipment`);
  await request(`/airports/${airportId}/drivers`);
  const staff = await request(`/airports/${airportId}/shift-eligible-staff`);
  if (!Array.isArray(staff)) throw new Error("Team Leader could not load shift-eligible-staff (the original bug)");
});

// --- The bug report: a driver with MORE THAN ONE vehicle assigned in the
// same shift couldn't inspect the second one. The seed data assigns both
// FCT-001 and AMB-004 to the same demo driver in the same shift, which is
// exactly this scenario — so these checks prove the fix, not just the API shape.
let assignments;
await check("Driver login + todayForMe() + my-assignments() shows BOTH vehicles", async () => {
  await loginAs(CNIC.driver);
  const shifts = await request("/shifts/today-for-me");
  if (!shifts.some((s) => s.id === shiftId)) throw new Error("today-for-me missing seeded shift");

  assignments = await request(`/shifts/${shiftId}/my-assignments`);
  if (assignments.length !== 2) throw new Error(`expected 2 assignments for this driver, got ${assignments.length}`);
  const regNos = assignments.map((a) => a.equipment.regNo).sort();
  if (regNos.join(",") !== "AMB-004,FCT-001") throw new Error(`expected both demo vehicles, got ${regNos.join(",")}`);
  if (assignments.some((a) => a.alreadySubmitted)) throw new Error("neither vehicle should be submitted yet");
});

await check("Driver submits vehicle #1 (AMB-004) — vehicle #2 (FCT-001) must remain independently available", async () => {
  const amb = assignments.find((a) => a.equipment.regNo === "AMB-004");
  const detail = await request(`/shifts/${shiftId}/my-assignments/${amb.assignmentId}`);
  if (detail.equipment.regNo !== "AMB-004") throw new Error("wrong vehicle in detail response");

  const responses = detail.checklist.items.map((i) => ({
    checklistItemId: i.id,
    value: i.inputType === "boolean" ? "pass" : i.inputType === "numeric" ? "1" : "ok",
  }));
  await request(`/shifts/${shiftId}/my-assignments/${amb.assignmentId}/inspection`, {
    method: "POST",
    body: JSON.stringify({ odometerReading: detail.equipment.currentOdometer + 5, responses }),
  });

  // The critical assertion: vehicle #2 must still show as NOT submitted,
  // and must still be independently fetchable/submittable.
  const refreshed = await request(`/shifts/${shiftId}/my-assignments`);
  const ambNow = refreshed.find((a) => a.equipment.regNo === "AMB-004");
  const fctNow = refreshed.find((a) => a.equipment.regNo === "FCT-001");
  if (!ambNow.alreadySubmitted) throw new Error("AMB-004 should now show as submitted");
  if (fctNow.alreadySubmitted) throw new Error("BUG REGRESSION: FCT-001 was incorrectly marked submitted too");
});

await check("Driver submits vehicle #2 (FCT-001) with a critical fail — independently of vehicle #1", async () => {
  const fct = assignments.find((a) => a.equipment.regNo === "FCT-001");
  const detail = await request(`/shifts/${shiftId}/my-assignments/${fct.assignmentId}`);
  if (detail.alreadySubmitted) throw new Error("FCT-001 should not be pre-submitted");

  const items = detail.checklist.items;
  const critItem = items.find((i) => i.isCritical);
  const responses = items.map((i) => ({
    checklistItemId: i.id,
    value: i.inputType === "boolean" ? (i.id === critItem.id ? "fail" : "pass") : i.inputType === "numeric" ? "1" : "ok",
    remarks: i.id === critItem.id ? "Integration test induced fault" : undefined,
  }));
  const result = await request(`/shifts/${shiftId}/my-assignments/${fct.assignmentId}/inspection`, {
    method: "POST",
    body: JSON.stringify({ odometerReading: detail.equipment.currentOdometer + 10, responses }),
  });
  if (!result.equipmentGrounded) throw new Error("expected equipmentGrounded true on critical fail");
  if (!result.faultsCreated.length) throw new Error("expected at least one fault created");
  faultId = result.faultsCreated[0].id;
});

await check("Driver: both vehicles now show alreadySubmitted, shift assignments both settled", async () => {
  const refreshed = await request(`/shifts/${shiftId}/my-assignments`);
  if (!refreshed.every((a) => a.alreadySubmitted)) throw new Error("expected both vehicles submitted");
});

await check("FaultsPage: faultsForAirport() with filters", async () => {
  await loginAs(CNIC.officer);
  const openCritical = await request(`/airports/${airportId}/faults?status=open&severity=critical`);
  if (!openCritical.some((f) => f.id === faultId)) throw new Error("expected the just-created fault in the filtered queue");
});

await check("FaultDetailPage: faultDetail() shape", async () => {
  const detail = await request(`/faults/${faultId}`);
  if (!Array.isArray(detail.alerts) || detail.alerts.length === 0) throw new Error("expected alerts dispatched");
  if (!Array.isArray(detail.logs)) throw new Error("expected logs array");
});

await check("Technician acknowledge + add log", async () => {
  await loginAs(CNIC.technician);
  const ack = await request(`/faults/${faultId}/acknowledge`, { method: "POST" });
  if (ack.faultStatus !== "in_progress") throw new Error("expected fault to move to in_progress");
  await request(`/faults/${faultId}/logs`, { method: "POST", body: JSON.stringify({ note: "Integration test diagnosis" }) });
});

await check("Officer resolve -> equipment reactivated", async () => {
  await loginAs(CNIC.officer);
  const result = await request(`/faults/${faultId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ resolutionNotes: "Integration test resolution" }),
  });
  if (!result.equipmentReactivated) throw new Error("expected equipmentReactivated true");
});

await check("Team Leader: shift now fully settled -> generateReport() + getReport()", async () => {
  await loginAs(CNIC.teamLeader);
  const report = await request(`/airports/${airportId}/shifts/${shiftId}/report`, {
    method: "POST",
    body: JSON.stringify({ summary: "Integration test shift report" }),
  });
  if (typeof report.fleetHealthScore !== "number") throw new Error("expected fleetHealthScore");
  if (report.vehiclesInspected !== 2) throw new Error(`expected 2 vehicles inspected, got ${report.vehiclesInspected}`);
  const fetched = await request(`/airports/${airportId}/shifts/${shiftId}/report`);
  if (fetched.id !== report.id) throw new Error("getReport mismatch");
});

await check("CFRO is now airport-scoped (not national) and sees only their own airport", async () => {
  const user = await loginAs(CNIC.cfro);
  if (user.airport?.id !== airportId) throw new Error("CFRO should be scoped to their appointed airport");
  const airports = await request("/airports");
  if (airports.length !== 1 || airports[0].id !== airportId) {
    throw new Error(`CFRO should see only their own airport, got ${airports.length}`);
  }
  await request(`/airports/${airportId}/equipment`);
});

await check("GM Fire: national scope, sees all airports (Admin-equivalent)", async () => {
  const user = await loginAs(CNIC.gmFire);
  if (user.role !== "GM_FIRE") throw new Error("wrong role returned");
  if (user.airport !== null) throw new Error("GM Fire should be national (no single airport)");
  const airports = await request("/airports");
  if (airports.length < 2) throw new Error("GM Fire should see multiple airports");
});

let testShiftGroupId;
await check("CFRO: can open a shift at their own airport (new hierarchy power)", async () => {
  await loginAs(CNIC.cfro);
  const groups = await request(`/airports/${airportId}/shift-groups`);
  if (!groups.length) throw new Error("expected at least one seeded shift group (crew) at the primary airport");
  testShiftGroupId = groups[0].id;
  const newShift = await request(`/airports/${airportId}/shifts`, {
    method: "POST",
    body: JSON.stringify({ shiftDate: "2020-06-15", shiftType: "evening", shiftGroupId: testShiftGroupId }),
  });
  if (!newShift.id) throw new Error("expected a created shift id");
  if (newShift.shiftGroupId !== testShiftGroupId) throw new Error("expected the shift to record the chosen crew");
  const live = await request(`/airports/${airportId}/shifts/${newShift.id}`);
  if (live.id !== newShift.id) throw new Error("CFRO-opened shift not retrievable");
  if (live.shiftGroupName !== groups[0].name) throw new Error("expected the live shift to show its crew's name");
});

await check("Opening a shift without a crew (shiftGroupId) is rejected (400)", async () => {
  try {
    await request(`/airports/${airportId}/shifts`, {
      method: "POST",
      body: JSON.stringify({ shiftDate: "2020-06-15", shiftType: "morning" }),
    });
    throw new Error("expected 400 (shiftGroupId required), got success");
  } catch (err) {
    if (!err.message.includes("400")) throw err;
  }
});

await check("Team Leader: assigns a vehicle with full crew (driver + supvr + sr supdt)", async () => {
  await loginAs(CNIC.admin);
  const allUsers = await request("/users");
  const supervisorId = allUsers.find((u) => u.role === "SUPVR" && u.airportId === airportId)?.id;
  const superintendentId = allUsers.find((u) => (u.role === "SR_SUPDT" || u.role === "SUPDT") && u.airportId === airportId)?.id;
  const driverId = allUsers.find((u) => u.role === "DRIVER" && u.airportId === airportId)?.id;

  await loginAs(CNIC.teamLeader);
  const crewShift = await request(`/airports/${airportId}/shifts`, {
    method: "POST",
    body: JSON.stringify({ shiftDate: "2020-06-16", shiftType: "night", shiftGroupId: testShiftGroupId }),
  });
  const anyEquipment = (await request(`/airports/${airportId}/equipment`)).find((e) => e.status === "active");

  const assignment = await request(`/airports/${airportId}/shifts/${crewShift.id}/assignments`, {
    method: "POST",
    body: JSON.stringify({ equipmentId: anyEquipment.id, driverId, supervisorId, superintendentId }),
  });

  const live = await request(`/airports/${airportId}/shifts/${crewShift.id}`);
  const a = live.assignments.find((x) => x.assignmentId === assignment.id);
  if (!a.supervisor || !a.superintendent) throw new Error("expected supervisor and superintendent on the live assignment");
  if (a.driver.id !== driverId) throw new Error("driver mismatch on assignment");
});

// --- Admin CRUD: equipment, airports, users, checklist templates ---

await check("Admin: GET /categories", async () => {
  await loginAs(CNIC.admin);
  const cats = await request("/categories");
  if (!Array.isArray(cats) || cats.length === 0) throw new Error("expected equipment categories");
  ambCategoryId = cats.find((c) => c.name === "Ambulance")?.id;
  jeepCategoryId = cats.find((c) => c.name === "Jeep")?.id;
  if (!ambCategoryId || !jeepCategoryId) throw new Error("expected seeded categories");
});

await check("Admin: create, update, and retire equipment", async () => {
  const created = await request(`/airports/${airportId}/equipment`, {
    method: "POST",
    body: JSON.stringify({ regNo: `TEST-${Date.now()}`, categoryId: jeepCategoryId, make: "Toyota" }),
  });
  newEquipmentId = created.id;

  await request(`/airports/${airportId}/equipment/${newEquipmentId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "under_maintenance" }),
  });
  const afterUpdate = await request(`/airports/${airportId}/equipment`);
  const found = afterUpdate.find((e) => e.id === newEquipmentId);
  if (found.status !== "under_maintenance") throw new Error("status update didn't take effect");

  const retired = await request(`/airports/${airportId}/equipment/${newEquipmentId}`, { method: "DELETE" });
  if (retired.status !== "retired") throw new Error("expected retire to set status=retired");
});

await check("Admin: create and update an airport", async () => {
  const created = await request("/airports", {
    method: "POST",
    body: JSON.stringify({ name: "Integration Test Airport", icaoCode: `T${Date.now()}`.slice(0, 4), region: "Test" }),
  });
  await request(`/airports/${created.id}`, { method: "PATCH", body: JSON.stringify({ region: "Updated Region" }) });
  const list = await request("/airports");
  const found = list.find((a) => a.id === created.id);
  if (found.region !== "Updated Region") throw new Error("airport update didn't take effect");
});

await check("Admin: create and edit a user (name, status)", async () => {
  const before = await request("/users");
  const created = await request("/users", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Integration Test Driver",
      cnic: `99999-${Date.now()}`.slice(0, 15),
      password: "TestPass123!",
      roleName: "DRIVER",
      airportId,
    }),
  });
  const after = await request("/users");
  if (after.length !== before.length + 1) throw new Error("expected user count to increase by 1");

  await request(`/users/${created.id}`, {
    method: "PATCH",
    body: JSON.stringify({ fullName: "Integration Test Driver (Edited)", status: "suspended" }),
  });
  const afterEdit = await request("/users");
  const found = afterEdit.find((u) => u.id === created.id);
  if (found.fullName !== "Integration Test Driver (Edited)") throw new Error("name update didn't take effect");
  if (found.status !== "suspended") throw new Error("status update didn't take effect");
});

await check("Admin: edit checklist template (update, add, retire items)", async () => {
  const before = await request(`/categories/${ambCategoryId}/checklist-template`);
  const kept = before.items.slice(0, 2).map((it, i) => (i === 0 ? { ...it, label: it.label + " (EDITED)" } : it));
  const items = kept.map(({ id, section, label, inputType, isCritical }) => ({ id, section, label, inputType, isCritical }));
  items.push({ section: "General", label: "Integration test new item", inputType: "boolean", isCritical: false });

  await request(`/categories/${ambCategoryId}/checklist-template`, { method: "PATCH", body: JSON.stringify({ items }) });

  const after = await request(`/categories/${ambCategoryId}/checklist-template`);
  if (after.items.length !== 3) throw new Error(`expected 3 items after edit, got ${after.items.length}`);
  if (!after.items.some((i) => i.label.includes("(EDITED)"))) throw new Error("edited label not found");
  if (!after.items.some((i) => i.label === "Integration test new item")) throw new Error("new item not found");
});

await check("Non-admin cannot edit checklist template (403)", async () => {
  await loginAs(CNIC.srSupdt);
  try {
    await request(`/categories/${ambCategoryId}/checklist-template`, {
      method: "PATCH",
      body: JSON.stringify({ items: [{ section: "x", label: "y", inputType: "boolean", isCritical: false }] }),
    });
    throw new Error("expected 403, got success");
  } catch (err) {
    if (!err.message.includes("403")) throw err;
  }
});

// --- New: equipment category create/rename, shift groups (crews), PDF handover report ---

await check("Admin: create and rename an equipment category", async () => {
  await loginAs(CNIC.admin);
  const created = await request("/categories", { method: "POST", body: JSON.stringify({ name: `Rescue Boat ${Date.now()}` }) });
  await request(`/categories/${created.id}`, { method: "PATCH", body: JSON.stringify({ name: "Renamed Rescue Boat" }) });
  const cats = await request("/categories");
  const found = cats.find((c) => c.id === created.id);
  if (found.name !== "Renamed Rescue Boat") throw new Error("category rename didn't take effect");
});

let groupAId, teamLeaderUserId;
await check("Admin: create shift groups (crews A/B), assign a user to one", async () => {
  const groupA = await request(`/airports/${airportId}/shift-groups`, { method: "POST", body: JSON.stringify({ name: `A-${Date.now()}` }) });
  groupAId = groupA.id;
  const groupB = await request(`/airports/${airportId}/shift-groups`, { method: "POST", body: JSON.stringify({ name: `B-${Date.now()}` }) });

  const users = await request("/users");
  teamLeaderUserId = users.find((u) => u.role === "TEAM_LEADER" && u.airportId === airportId).id;
  await request(`/users/${teamLeaderUserId}`, { method: "PATCH", body: JSON.stringify({ shiftGroupId: groupAId }) });

  const groupsAfter = await request(`/airports/${airportId}/shift-groups`);
  const foundAAfter = groupsAfter.find((g) => g.id === groupAId);
  if (foundAAfter.memberCounts.teamLeaders !== 1) throw new Error("expected 1 team leader in crew A after assignment");

  // Cleanup: unassign so it doesn't interfere with anything else, then delete both groups
  await request(`/users/${teamLeaderUserId}`, { method: "PATCH", body: JSON.stringify({ shiftGroupId: null }) });
  await request(`/airports/${airportId}/shift-groups/${groupAId}`, { method: "DELETE" });
  await request(`/airports/${airportId}/shift-groups/${groupB.id}`, { method: "DELETE" });
});

await check("Admin: GM Fire (national role) cannot be assigned a shift group (400)", async () => {
  const users = await request("/users");
  const gmFireId = users.find((u) => u.role === "GM_FIRE").id;
  const tempGroup = await request(`/airports/${airportId}/shift-groups`, { method: "POST", body: JSON.stringify({ name: `TEMP-${Date.now()}` }) });
  try {
    await request(`/users/${gmFireId}`, { method: "PATCH", body: JSON.stringify({ shiftGroupId: tempGroup.id }) });
    throw new Error("expected 400, got success");
  } catch (err) {
    if (!err.message.includes("400")) throw err;
  } finally {
    await request(`/airports/${airportId}/shift-groups/${tempGroup.id}`, { method: "DELETE" });
  }
});

await check("CFRO: creates a shift group and appoints a driver to it (new hierarchy power)", async () => {
  await loginAs(CNIC.cfro);
  const group = await request(`/airports/${airportId}/shift-groups`, { method: "POST", body: JSON.stringify({ name: `CFRO-CREW-${Date.now()}` }) });
  await request(`/airports/${airportId}/shift-groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ name: `CFRO-CREW-RENAMED-${Date.now()}` }) });

  const staff = await request(`/airports/${airportId}/shift-eligible-staff`);
  const driver = staff.find((s) => s.role === "DRIVER");
  await request(`/airports/${airportId}/shift-groups/${group.id}/members`, { method: "POST", body: JSON.stringify({ userId: driver.id }) });

  const groups = await request(`/airports/${airportId}/shift-groups`);
  const found = groups.find((g) => g.id === group.id);
  if (found.memberCounts.drivers !== 1) throw new Error("CFRO's crew appointment didn't take effect");

  // Cleanup
  await request(`/airports/${airportId}/shift-groups/${group.id}/members/${driver.id}`, { method: "DELETE" });
  await request(`/airports/${airportId}/shift-groups/${group.id}`, { method: "DELETE" });
});

await check("CFRO: appoints a new Asstt at their own airport (new hierarchy power)", async () => {
  await loginAs(CNIC.cfro);
  const created = await request("/users", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Integration Test Asstt",
      cnic: `88888-${Date.now()}`.slice(0, 15),
      password: "TestPass123!",
      roleName: "ASSTT",
    }),
  });
  const users = await request("/users");
  const found = users.find((u) => u.id === created.id);
  if (!found) throw new Error("CFRO-appointed user not found in scoped /users list");
  if (found.airportId !== airportId) throw new Error("CFRO-appointed user should land at the CFRO's own airport");
  if (found.role !== "ASSTT") throw new Error("expected role ASSTT");
});

await check("CFRO: cannot appoint an Admin/GM Fire/CFRO role (403)", async () => {
  try {
    await request("/users", {
      method: "POST",
      body: JSON.stringify({
        fullName: "Should Be Rejected",
        cnic: `77777-${Date.now()}`.slice(0, 15),
        password: "TestPass123!",
        roleName: "ADMIN",
      }),
    });
    throw new Error("expected 403, got success");
  } catch (err) {
    if (!err.message.includes("403")) throw err;
  }
});

await check("CFRO: cannot appoint staff to a different airport (airportId in body is ignored/rejected)", async () => {
  await loginAs(CNIC.admin);
  const otherAirport = await request("/airports", {
    method: "POST",
    body: JSON.stringify({ name: "Other Test Airport", icaoCode: `O${Date.now()}`.slice(0, 4), region: "Test" }),
  });
  await loginAs(CNIC.cfro);
  const created = await request("/users", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Should Land At CFRO Airport Not Other",
      cnic: `66666-${Date.now()}`.slice(0, 15),
      password: "TestPass123!",
      roleName: "DRIVER",
      airportId: otherAirport.id,
    }),
  });
  const users = await request("/users");
  const found = users.find((u) => u.id === created.id);
  if (found.airportId !== airportId) throw new Error("CFRO should not be able to appoint staff to another airport");
});

await check("CFRO: toggles own airport's shift pattern; a shift type outside the new pattern is then rejected", async () => {
  // Use a brand-new airport with no open shifts, so this test isolates the
  // pattern-toggle behaviour rather than tripping the (correct) safety
  // check against open shifts left by earlier tests on the main airport.
  await loginAs(CNIC.admin);
  const patternTestAirport = await request("/airports", {
    method: "POST",
    body: JSON.stringify({ name: "Pattern Toggle Test Airport", icaoCode: `P${Date.now()}`.slice(0, 4), region: "Test", shiftPattern: "3_shift" }),
  });
  const patternCrew = await request(`/airports/${patternTestAirport.id}/shift-groups`, { method: "POST", body: JSON.stringify({ name: "A" }) });

  await request(`/airports/${patternTestAirport.id}/shift-pattern`, { method: "PATCH", body: JSON.stringify({ shiftPattern: "2_shift" }) });
  const afterToggle = await request("/airports");
  if (afterToggle.find((a) => a.id === patternTestAirport.id).shiftPattern !== "2_shift") throw new Error("shift pattern toggle didn't take effect");

  try {
    await request(`/airports/${patternTestAirport.id}/shifts`, {
      method: "POST",
      body: JSON.stringify({ shiftDate: "2020-07-01", shiftType: "evening", shiftGroupId: patternCrew.id }),
    });
    throw new Error("expected 400 (evening not valid under 2_shift), got success");
  } catch (err) {
    if (!err.message.includes("400")) throw err;
  }

  // A valid 2-shift type should still work.
  const validShift = await request(`/airports/${patternTestAirport.id}/shifts`, {
    method: "POST",
    body: JSON.stringify({ shiftDate: "2020-07-01", shiftType: "night", shiftGroupId: patternCrew.id }),
  });
  if (!validShift.id) throw new Error("expected 'night' to be accepted under a 2_shift pattern");

  // Switching back should now be blocked by the same safety check, since
  // that 'night' shift is still open under the old (3_shift) numbering too —
  // 'night' is valid under both patterns, so instead prove the safety check
  // via the 'evening'-type shift on the CFRO's real airport from an earlier
  // check, using the officer to resolve it isn't necessary — just confirm
  // this fresh airport's pattern is what we set it to.
  const finalCheck = await request("/airports");
  if (finalCheck.find((a) => a.id === patternTestAirport.id).shiftPattern !== "2_shift") throw new Error("pattern should remain 2_shift");
});

await check("Shift pattern toggle is blocked while an incompatible open shift exists", async () => {
  // The CFRO's real airport has an open 'evening' shift left by an earlier
  // check ("CFRO: can open a shift at their own airport"). Switching to
  // 2_shift (morning/night only) must be rejected until that shift's report
  // is issued.
  await loginAs(CNIC.cfro);
  try {
    await request(`/airports/${airportId}/shift-pattern`, { method: "PATCH", body: JSON.stringify({ shiftPattern: "2_shift" }) });
    throw new Error("expected 400 (open 'evening' shift blocks the switch), got success");
  } catch (err) {
    if (!err.message.includes("400")) throw err;
  }
  const airports = await request("/airports");
  if (airports.find((a) => a.id === airportId).shiftPattern !== "3_shift") throw new Error("pattern should be unchanged (still 3_shift)");
});

await check("PDF handover report: downloads a valid PDF with the fleet snapshot", async () => {
  await loginAs(CNIC.teamLeader);
  const res = await fetch(`${API_URL}/airports/${airportId}/shifts/${shiftId}/report/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`PDF download failed with ${res.status}`);
  const contentType = res.headers.get("content-type");
  if (!contentType?.includes("application/pdf")) throw new Error(`expected application/pdf, got ${contentType}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const header = buf.subarray(0, 5).toString("ascii");
  if (header !== "%PDF-") throw new Error(`expected a PDF file signature, got "${header}"`);
  if (buf.length < 500) throw new Error(`PDF suspiciously small (${buf.length} bytes) — likely a rendering failure`);
});

await check("PDF handover report: 404 for a shift with no issued report", async () => {
  await loginAs(CNIC.admin);
  const groups = await request(`/airports/${airportId}/shift-groups`);
  const created = await request(`/airports/${airportId}/shifts`, {
    method: "POST",
    body: JSON.stringify({ shiftDate: "2020-01-01", shiftType: "night", shiftGroupId: testShiftGroupId ?? groups[0]?.id }),
  });
  try {
    const res = await fetch(`${API_URL}/airports/${airportId}/shifts/${created.id}/report/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  } finally {
    // no delete-shift endpoint exists; leaving this harmless orphan shift is fine for a test run
  }
});

await check("GM Fire: has Admin-equivalent CRUD (create equipment, edit checklist template)", async () => {
  await loginAs(CNIC.gmFire);
  const created = await request(`/airports/${airportId}/equipment`, {
    method: "POST",
    body: JSON.stringify({ regNo: `GMTEST-${Date.now()}`, categoryId: jeepCategoryId, make: "Toyota" }),
  });
  await request(`/airports/${airportId}/equipment/${created.id}`, { method: "DELETE" }); // retire (soft delete)

  const before = await request(`/categories/${ambCategoryId}/checklist-template`);
  await request(`/categories/${ambCategoryId}/checklist-template`, {
    method: "PATCH",
    body: JSON.stringify({ items: before.items.map(({ id, section, label, inputType, isCritical }) => ({ id, section, label, inputType, isCritical })) }),
  });
});

console.log(`\n${passed} check(s) passed.`);
if (process.exitCode) console.log("SOME CHECKS FAILED — see FAIL lines above.");
else console.log("ALL CHECKS PASSED.");
