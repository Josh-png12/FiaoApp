// POST /api/auth/register — crea la tienda + usuario DUEÑO y abre sesión.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  signSession,
  setSessionCookie,
  normalizePhone,
  isValidPin,
} from "@/lib/auth";

const schema = z.object({
  storeName: z.string().min(2).max(80),
  ownerName: z.string().min(2).max(80),
  phone: z.string(),
  pin: z.string(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: "El número de celular no es válido" },
      { status: 400 }
    );
  }
  if (!isValidPin(parsed.data.pin)) {
    return NextResponse.json(
      { error: "El PIN debe tener entre 4 y 6 números" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    return NextResponse.json(
      { error: "Ese celular ya está registrado. Intenta entrar." },
      { status: 409 }
    );
  }

  const pinHash = await bcrypt.hash(parsed.data.pin, 10);

  const store = await prisma.store.create({
    data: {
      name: parsed.data.storeName.trim(),
      ownerName: parsed.data.ownerName.trim(),
      phone,
      users: {
        create: {
          name: parsed.data.ownerName.trim(),
          phone,
          pinHash,
          role: "OWNER",
        },
      },
    },
    include: { users: true },
  });

  const user = store.users[0];
  const token = await signSession({
    userId: user.id,
    storeId: store.id,
    role: "OWNER",
    name: user.name,
  });
  await setSessionCookie(token);

  return NextResponse.json({ ok: true, storeName: store.name });
}
