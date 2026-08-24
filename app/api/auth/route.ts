import { ensureSchema } from "@/db";
import { assertSameOrigin, createPassword, endSession, errorResponse, HttpError, passwordMatches, startSession } from "@/lib/auth";
import { getAccountState } from "@/lib/state";

export const runtime = "nodejs";

type AuthBody = {
  mode?: unknown;
  name?: unknown;
  username?: unknown;
  email?: unknown;
  phone?: unknown;
  password?: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json() as AuthBody;
    const mode = body.mode;
    const username = clean(body.username).replace(/^@/, "").toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";

    if (mode !== "signup" && mode !== "signin") throw new HttpError(400, "Choose sign up or sign in.");
    if (!/^[a-z0-9]{3,}$/.test(username)) throw new HttpError(400, "Use at least 3 letters or numbers for the username.");
    if (password.length < 8) throw new HttpError(400, "Your password needs at least 8 characters.");

    const database = await ensureSchema();
    if (mode === "signup") {
      const name = clean(body.name);
      const email = clean(body.email).toLowerCase();
      const phone = clean(body.phone);
      if (name.length < 2) throw new HttpError(400, "Enter the name your contacts will recognize.");
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");

      const existing = await database.execute({
        sql: "SELECT username, email FROM users WHERE username = ? OR email = ? LIMIT 1",
        args: [username, email],
      });
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (String(row.username).toLowerCase() === username) throw new HttpError(409, "That username is already in use.");
        throw new HttpError(409, "That email already has an account.");
      }

      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const credentials = createPassword(password);
      await database.execute({
        sql: `INSERT INTO users
          (id, username, name, email, phone, password_salt, password_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, username, name, email, phone, credentials.salt, credentials.hash, createdAt],
      });
      await startSession(id);
      return Response.json({ account: await getAccountState({ id, username, name, email, phone }) }, { status: 201 });
    }

    const result = await database.execute({
      sql: "SELECT id, username, name, email, phone, password_salt, password_hash FROM users WHERE username = ? LIMIT 1",
      args: [username],
    });
    const row = result.rows[0];
    if (!row || !passwordMatches(password, String(row.password_salt), String(row.password_hash))) {
      throw new HttpError(401, "That username or password is incorrect.");
    }

    const user = {
      id: String(row.id),
      username: String(row.username),
      name: String(row.name),
      email: String(row.email),
      phone: String(row.phone ?? ""),
    };
    await startSession(user.id);
    return Response.json({ account: await getAccountState(user) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    await endSession();
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
