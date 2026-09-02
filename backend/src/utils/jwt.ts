import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

// The shape of data embedded in every access token. This is the basis for
// every RBAC + airport-scoping check in the app (Architecture Doc, 9.3).
export interface JwtPayload {
  userId: string;
  role: string; // RoleName, e.g. "SUPDT"
  isNational: boolean;
  airportId: string | null;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
