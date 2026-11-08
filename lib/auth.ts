// =====================================================================
// lib/auth.ts — Auth propia: teléfono + PIN.
// JWT firmado con jose (compatible con Edge middleware), cookie httpOnly.
// El PIN se hashea con bcrypt. Nada de emails ni NextAuth.
// =====================================================================
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "fiao_session";
const SESSION_DAYS = 90; // el tendero no debe re-loguearse cada rato

export interface SessionPayload {
  userId: string;
  storeId: string;
  role: "OWNER" | "EMPLOYEE";
  name: string;
  [key: string]: unknown; // requerido por jose JWTPayload
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Falta JWT_SECRET en variables de entorno");
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify<SessionPayload>(token, getSecret());
    if (!payload.userId || !payload.storeId) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/** Sesión del request actual (server components / route handlers). */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Setea la cookie de sesión (llamar desde route handler). */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Normaliza teléfono colombiano: quita espacios/guiones, admite +57. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s\-().+]/g, "");
  if (/^57\d{10}$/.test(digits)) return digits.slice(2); // quita indicativo
  if (/^3\d{9}$/.test(digits)) return digits; // celular colombiano
  return null;
}

/** Valida PIN: 4 a 6 dígitos. */
export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}
