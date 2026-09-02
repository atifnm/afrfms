import { Request, Response, NextFunction } from "express";
import { verifyToken, JwtPayload } from "../utils/jwt";

// Augment Express's Request type so `req.user` is typed everywhere downstream.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Verifies the Bearer token on every protected request and attaches the
 * decoded claims (userId, role, isNational, airportId) to req.user.
 * Every downstream permission check reads from req.user — the client's
 * claims about itself are never trusted directly.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  const token = header.slice("Bearer ".length);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Role guard — restricts a route to a specific set of roles.
 * Usage: router.get("/users", requireAuth, requireRole("ADMIN"), handler)
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden — role not permitted for this action" });
    }
    next();
  };
}

/**
 * Airport-scope guard — for routes that take an :airportId param.
 * National-scope users (ADMIN, GM_FIRE) pass through unrestricted.
 * Airport-scoped users (CFRO and everyone below them) may only access data
 * for their own assigned airport, regardless of what the request/client
 * claims — this is the server-side enforcement described in Architecture
 * Doc Section 9.3/9.4.
 */
export function requireAirportScope(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.isNational) return next();

  const requestedAirportId = req.params.airportId;
  if (!requestedAirportId) {
    return res.status(400).json({ error: "airportId is required" });
  }
  if (req.user.airportId !== requestedAirportId) {
    return res.status(403).json({ error: "Forbidden — outside your assigned airport" });
  }
  next();
}

/**
 * Same rule as requireAirportScope, exposed as a plain function for routes
 * that must first look up which airport a resource (a shift, a submission)
 * belongs to before they can check access — e.g. /shifts/:shiftId/inspections.
 */
export function canAccessAirport(user: JwtPayload, airportId: string): boolean {
  return user.isNational || user.airportId === airportId;
}
