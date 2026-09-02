import { NavLink, Outlet } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS, type Role } from "../api/types";

interface NavItem {
  to: string;
  label: string;
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { to: "/my-shift", label: "My Shift", roles: ["DRIVER"] },
  { to: "/shifts", label: "Shifts", roles: ["TEAM_LEADER", "SUPVR", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"] },
  {
    to: "/faults",
    label: "Fault Queue",
    roles: ["MECH_TECHNICIAN", "MECH_OFFICER", "SUPVR", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"],
  },
  { to: "/airports", label: "Airports & Fleet", roles: ["CFRO", "SR_SUPDT", "SUPDT", "SUPVR", "ADMIN", "GM_FIRE"] },
  { to: "/checklists", label: "Checklist Templates", roles: ["ADMIN", "GM_FIRE"] },
  { to: "/shift-groups", label: "Shift Groups", roles: ["CFRO", "ADMIN", "GM_FIRE"] },
  { to: "/users", label: "Users", roles: ["ADMIN", "GM_FIRE", "CFRO"] },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  if (!user) return null;

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  const sidebarContent = (
    <>
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <img src="/paa-logo.png" alt="Pakistan Airport Authority" className="h-9 w-9 rounded-full" />
        <div>
          <p className="font-display text-sm font-semibold leading-tight">AFRFMS</p>
          <p className="text-[11px] leading-tight text-white/60">Fire &amp; Rescue Fleet</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive ? "bg-white/10 text-white border-l-2 border-brand-gold" : "text-white/75 hover:bg-white/5 hover:text-white"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 px-5 py-4">
        <p className="text-sm font-medium text-white">{user.fullName}</p>
        <p className="text-xs text-white/60">{ROLE_LABELS[user.role]}</p>
        <p className="text-xs text-brand-gold">{user.airport?.name ?? "National"}</p>
        <button
          onClick={logout}
          className="mt-3 text-xs font-medium text-white/70 underline decoration-white/30 underline-offset-2 hover:text-white"
        >
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-surface md:flex-row flex-col">
      {/* Mobile top bar */}
      <div className="flex items-center justify-between bg-brand px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <img src="/paa-logo.png" alt="" className="h-7 w-7 rounded-full" />
          <span className="font-display text-sm font-semibold text-white">AFRFMS</span>
        </div>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-medium text-white"
        >
          {mobileOpen ? "Close" : "Menu"}
        </button>
      </div>
      {mobileOpen && <div className="flex flex-col bg-brand md:hidden">{sidebarContent}</div>}

      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-shrink-0 flex-col bg-brand text-white md:flex">{sidebarContent}</aside>

      <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
