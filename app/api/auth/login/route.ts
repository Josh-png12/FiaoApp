// POST /api/auth/login — teléfono + PIN.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signSession, setSessionCookie, normalizePhone } from "@/lib/auth";

const schema = z.object({ phone: z.string(), pin: z.string() });

// Mensaje único para no revelar si el teléfono existe.
const FAIL = { error: "Celular o PIN incorrecto" };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(FAIL, { status: 401 });
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json(FAIL, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { phone },
    include: { store: true },
  });
  if (!user || !user.isActive || !user.store.isActive) {
    return NextResponse.json(FAIL, { status: 401 });
  }

  const ok = await bcrypt.compare(parsed.data.pin, user.pinHash);
  if (!ok) return NextResponse.json(FAIL, { status: 401 });

  const token = await signSession({
    userId: user.id,
    storeId: user.storeId,
    role: user.role,
    name: user.name,
  });
  await setSessionCookie(token);

  return NextResponse.json({ ok: true, storeName: user.store.name });
}
