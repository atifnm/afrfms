import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { RequireAuth, RequireRole } from "./auth/guards";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DriverAssignmentPage } from "./pages/DriverAssignmentPage";
import { ShiftsPage } from "./pages/ShiftsPage";
import { ShiftDetailPage } from "./pages/ShiftDetailPage";
import { FaultsPage } from "./pages/FaultsPage";
import { FaultDetailPage } from "./pages/FaultDetailPage";
import { AirportsPage } from "./pages/AirportsPage";
import { ChecklistAdminPage } from "./pages/ChecklistAdminPage";
import { ShiftGroupsPage } from "./pages/ShiftGroupsPage";
import { UsersPage } from "./pages/UsersPage";
import type { Role } from "./api/types";

const DEFAULT_ROUTE: Record<Role, string> = {
  DRIVER: "/my-shift",
  TEAM_LEADER: "/shifts",
  SR_SUPDT: "/shifts",
  SUPDT: "/shifts",
  SUPVR: "/shifts",
  ASSTT: "/shifts",
  CFRO: "/shifts",
  MECH_TECHNICIAN: "/faults",
  MECH_OFFICER: "/faults",
  ADMIN: "/users",
  GM_FIRE: "/users",
};

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return null;
  return <Navigate to={DEFAULT_ROUTE[user.role]} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<HomeRedirect />} />
          <Route
            path="/my-shift"
            element={
              <RequireRole roles={["DRIVER"]}>
                <DriverAssignmentPage />
              </RequireRole>
            }
          />
          <Route
            path="/shifts"
            element={
              <RequireRole roles={["TEAM_LEADER", "SUPVR", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"]}>
                <ShiftsPage />
              </RequireRole>
            }
          />
          <Route
            path="/shifts/:shiftId"
            element={
              <RequireRole roles={["TEAM_LEADER", "SUPVR", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"]}>
                <ShiftDetailPage />
              </RequireRole>
            }
          />
          <Route
            path="/faults"
            element={
              <RequireRole roles={["MECH_TECHNICIAN", "MECH_OFFICER", "SUPVR", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"]}>
                <FaultsPage />
              </RequireRole>
            }
          />
          <Route
            path="/faults/:faultId"
            element={
              <RequireRole roles={["MECH_TECHNICIAN", "MECH_OFFICER", "SUPVR", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"]}>
                <FaultDetailPage />
              </RequireRole>
            }
          />
          <Route
            path="/airports"
            element={
              <RequireRole roles={["CFRO", "SR_SUPDT", "SUPDT", "SUPVR", "ADMIN", "GM_FIRE"]}>
                <AirportsPage />
              </RequireRole>
            }
          />
          <Route
            path="/checklists"
            element={
              <RequireRole roles={["ADMIN", "GM_FIRE"]}>
                <ChecklistAdminPage />
              </RequireRole>
            }
          />
          <Route
            path="/shift-groups"
            element={
              <RequireRole roles={["CFRO", "ADMIN", "GM_FIRE"]}>
                <ShiftGroupsPage />
              </RequireRole>
            }
          />
          <Route
            path="/users"
            element={
              <RequireRole roles={["ADMIN", "GM_FIRE", "CFRO"]}>
                <UsersPage />
              </RequireRole>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
