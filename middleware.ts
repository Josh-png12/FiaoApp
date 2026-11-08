// Protege todas las rutas de la app salvo login/registro y sus APIs.
import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/registro", "/api/auth/login", "/api/auth/register"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  // Usuario logueado en página pública → mandarlo a Hoy
  if (isPublic && session && !pathname.startsWith("/api")) {
    return NextResponse.redirect(new URL("/hoy", req.url));
  }

  if (isPublic) return NextResponse.next();

  if (!session) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Todo excepto estáticos de Next
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|icons).*)"],
};
