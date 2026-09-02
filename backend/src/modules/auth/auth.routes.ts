import { Router } from "express";
import { z } from "zod";
import { login, InvalidCredentialsError, AccountSuspendedError } from "./auth.service";
import { requireAuth } from "../../middleware/auth";
import { db } from "../../db/client";

const router = Router();

const loginSchema = z.object({
  cnic: z.string().min(1, "CNIC is required"),
  password: z.string().min(1, "Password is required"),
});

// POST /auth/login — CNIC + password, returns a JWT carrying role + airport claims.
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  try {
    const result = await login(parsed.data.cnic, parsed.data.password);
    res.json(result);
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return res.status(401).json({ error: "Invalid CNIC or password" });
    }
    if (err instanceof AccountSuspendedError) {
      return res.status(403).json({ error: "Account is suspended — contact your administrator" });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /auth/me — returns the profile for the currently authenticated user.
router.get("/me", requireAuth, async (req, res) => {
  const user = (await db
    .prepare(
      `SELECT u.id, u.full_name, u.cnic, u.last_login_at, u.airport_id,
              r.name AS role_name, r.is_national AS is_national,
              a.name AS airport_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN airports a ON a.id = u.airport_id
       WHERE u.id = ?`
    )
    .get(req.user!.userId)) as any;

  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({
    id: user.id,
    fullName: user.full_name,
    cnic: user.cnic,
    role: user.role_name,
    isNational: !!user.is_national,
    airport: user.airport_id ? { id: user.airport_id, name: user.airport_name } : null,
    lastLoginAt: user.last_login_at,
  });
});

export default router;
