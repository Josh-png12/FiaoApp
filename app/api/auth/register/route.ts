// POST /api/auth/register — crea la tienda + usuario DUEÑO y abre sesión.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateStoreCode } from "@/lib/store-code";
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

  // Store.code es obligatorio y único (R2): se genera aquí y se reintenta si choca con otro.
  // (La carrera de registro por celular repetido, P2002 en phone, se resuelve en el paso 3.)
  const ownerData = {
    name: parsed.data.ownerName.trim(),
    phone,
    pinHash,
    role: "OWNER" as const,
  };
  let store;
  for (let attempt = 1; ; attempt++) {
    try {
      store = await prisma.store.create({
        data: {
          code: generateStoreCode(),
          name: parsed.data.storeName.trim(),
          ownerName: parsed.data.ownerName.trim(),
          phone,
          users: { create: ownerData },
        },
        include: { users: true },
      });
      break;
    } catch (e) {
      const codeCollision =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        String(e.meta?.target ?? "").includes("code");
      if (!codeCollision || attempt >= 5) throw e;
    }
  }

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
