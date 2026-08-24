import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { ensureSchema } from "@/db";

const SESSION_COOKIE = "famochat_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  email: string;
  phone: string;
};

function sessionHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  return { salt, hash: scryptSync(password, salt, 64).toString("base64url") };
}

export function passwordMatches(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(scryptSync(password, salt, 64).toString("base64url"));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_SECONDS * 1000;
  const database = await ensureSchema();
  await database.batch([
    { sql: "DELETE FROM sessions WHERE expires_at <= ?", args: [now] },
    { sql: "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", args: [sessionHash(token), userId, expiresAt, now] },
  ], "write");

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const database = await ensureSchema();
    await database.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [sessionHash(token)] });
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const database = await ensureSchema();
  const result = await database.execute({
    sql: `SELECT u.id, u.username, u.name, u.email, u.phone
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
      LIMIT 1`,
    args: [sessionHash(token), Date.now()],
  });
  const row = result.rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    username: String(row.username),
    name: String(row.name),
    email: String(row.email),
    phone: String(row.phone ?? ""),
  };
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "Sign in to continue.");
  return user;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host || new URL(origin).host !== host) throw new HttpError(403, "Request origin was rejected.");
}
