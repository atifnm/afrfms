import "dotenv/config";
import express from "express";
import cors from "cors";
// Patches Express Router so errors thrown/rejected inside async route
// handlers are forwarded to the error-handling middleware below instead of
// becoming an unhandled promise rejection that crashes the whole process.
import "express-async-errors";

import authRoutes from "./modules/auth/auth.routes";
import usersRoutes from "./modules/users/users.routes";
import airportsRoutes from "./modules/airports/airports.routes";
import equipmentRoutes from "./modules/equipment/equipment.routes";
import checklistsRoutes from "./modules/checklists/checklists.routes";
import shiftsRoutes from "./modules/shifts/shifts.routes";
import inspectionsRoutes from "./modules/inspections/inspections.routes";
import { airportFaultsRouter, faultDetailRouter } from "./modules/faults/faults.routes";

const app = express();

// Allow the deployed frontend to call this API. Set FRONTEND_URL to your
// static site's URL (e.g. https://afrfms.onrender.com) once you know it —
// comma-separate multiple origins if needed. If unset, all origins are
// allowed (fine for local dev / initial deploy, not recommended long-term).
const allowedOrigins = process.env.FRONTEND_URL?.split(",").map((o) => o.trim());
app.use(
  cors({
    origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : true,
  })
);
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", service: "afrfms-backend" }));

app.use("/auth", authRoutes);
app.use("/users", usersRoutes);
app.use("/airports", airportsRoutes);
// Nested under /airports since equipment and shifts are always accessed within an airport scope.
app.use("/airports", equipmentRoutes);
app.use("/airports", shiftsRoutes);
app.use("/categories", checklistsRoutes);
// Driver-facing: /shifts/:shiftId/my-assignments[/:assignmentId], /shifts/:shiftId/my-assignments/:assignmentId/inspection
app.use("/shifts", inspectionsRoutes);
// Mixed paths: /airports/:airportId/faults (list) and /faults/:faultId/... (detail/actions)
app.use("/airports", airportFaultsRouter);
app.use("/faults", faultDetailRouter);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Global error handler — must be last, and must take 4 args for Express to
// recognize it as an error handler. Any error thrown/rejected anywhere in
// the request pipeline lands here instead of crashing the process.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Belt-and-suspenders: log and keep running rather than crash on anything
// that somehow still slips past the middleware above (e.g. errors raised
// outside a request, such as during startup).
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000;
app.listen(PORT, () => {
  console.log(`AFRFMS backend listening on http://localhost:${PORT}`);
});
