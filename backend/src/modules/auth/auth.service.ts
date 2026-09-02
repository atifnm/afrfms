import bcrypt from "bcryptjs";
import { db } from "../../db/client";
import { signToken } from "../../utils/jwt";
import { logAction } from "../../utils/audit";
import { nowSql } from "../../utils/now";

export class InvalidCredentialsError extends Error {}
export class AccountSuspendedError extends Error {}

interface UserRow {
  id: string;
  full_name: string;
  cnic: string;
  password_hash: string;
  status: string;
  role_id: string;
  airport_id: string | null;
  role_name: string;
  is_national: number;
  airport_name: string | null;
}

export async function login(cnic: string, password: string) {
  const user = (await db
    .prepare(
      `SELECT u.id, u.full_name, u.cnic, u.password_hash, u.status, u.role_id, u.airport_id,
              r.name AS role_name, r.is_national AS is_national,
              a.name AS airport_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN airports a ON a.id = u.airport_id
       WHERE u.cnic = ?`
    )
    .get(cnic)) as UserRow | undefined;

  if (!user) throw new InvalidCredentialsError();

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new InvalidCredentialsError();

  if (user.status !== "active") throw new AccountSuspendedError();

  const token = signToken({
    userId: user.id,
    role: user.role_name,
    isNational: !!user.is_national,
    airportId: user.airport_id,
  });

  await db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(nowSql(), user.id);
  await logAction(user.id, "LOGIN");

  return {
    token,
    user: {
      id: user.id,
      fullName: user.full_name,
      role: user.role_name,
      airport: user.airport_id ? { id: user.airport_id, name: user.airport_name } : null,
    },
  };
}
