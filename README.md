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
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint (flat config)
npm run test         # tests unitarios (vitest)
npm run build        # prisma generate + next build
npx prisma studio    # explorar la DB
```

## Estado

Implementado:

- [x] Scaffold Next.js 15 + TS + Tailwind 4 + Prisma
- [x] Schema multi-tenant por `storeId`, con `Decimal` para dinero y anulación por `voidedAt`
- [x] Auth teléfono + PIN (JWT httpOnly, middleware)
- [x] Helpers con tests unitarios: `lib/money.ts`, `lib/dates.ts`, `lib/db.ts` (`storeDb` cubre solo cliente, venta y abono)
- [x] UI: login, registro y pantalla Hoy (saldos derivados)

Aún NO existe:

- [ ] Fiados (`/fiados`) y Ventas (`/ventas`): son solo páginas placeholder
- [ ] Offline / PWA / sincronización (no hay service worker, Dexie ni `/api/sync`)
- [ ] Productos, inventario, estadísticas y cierre de caja (solo modelados en el schema)
- [ ] Pruebas de integración con base de datos
- [ ] Deploy al VPS (PM2 + Nginx)

Ver `CLAUDE.md` para reglas de dominio y `docs/04-ROADMAP.md` para el plan.
