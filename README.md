# FiaoApp

El cuaderno digital del tendero: fiado, ventas, inventario y ganancias. PWA offline-first para tiendas de barrio de Riohacha.

## Primeros pasos

```bash
npm install
cp .env.example .env   # llenar DATABASE_URL (Neon) y JWT_SECRET
npx prisma migrate dev --name init
npm run dev
```

## Comandos

```bash
npm run dev          # desarrollo
npm run test         # tests unitarios (vitest)
npm run build        # prisma generate + next build
npx prisma studio    # explorar la DB
```

## Estado (Sprint 1)

- [x] Scaffold Next.js 15 + TS + Tailwind 4 + Prisma
- [x] Schema completo (multi-tenant por storeId, append-only, Decimal)
- [x] Auth teléfono + PIN (JWT httpOnly, middleware)
- [x] Helpers core con tests: `lib/money.ts`, `lib/dates.ts`, `lib/db.ts`
- [x] UI: login, registro, pantalla Hoy (con saldos derivados reales)
- [ ] Deploy al VPS (PM2 + Nginx) — pendiente

Ver `CLAUDE.md` para reglas de dominio y `docs/04-ROADMAP.md` para el plan.
