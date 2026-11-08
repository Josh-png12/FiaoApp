# CLAUDE.md — FiaoApp (SaaS para tiendas de barrio)

## Qué es este proyecto
PWA offline-first para tenderos de Riohacha: fiado, ventas, inventario, ganancias y cierre de caja.
El usuario NUNCA ha usado software de negocios. Referencia mental: el cuaderno de fiado.
Ver `docs/01-ESPECIFICACION.md` para la visión completa y `prisma/schema.prisma` para el modelo.

## Stack
- Next.js 15 (App Router) + TypeScript estricto + Tailwind CSS
- Prisma + PostgreSQL (Neon en dev, Postgres local en VPS en prod)
- PWA: service worker + Dexie.js (IndexedDB) para offline
- Auth propia: teléfono + PIN (bcrypt), JWT en cookie httpOnly
- Deploy: VPS con PM2 + Nginx (mismo pipeline que SIEPA)

## Reglas de dominio (NO negociables)
1. **Dinero**: `Decimal` de Prisma siempre. Prohibido `Float`/`number` para montos en DB.
   En el cliente usar enteros de centavos o decimal.js para aritmética.
2. **Append-only**: ventas, fiados y abonos NUNCA se editan ni borran.
   Anular = setear `voidedAt`. Corregir = anular + crear nuevo movimiento.
3. **Saldos derivados**: el saldo de un cliente fiado se calcula desde movimientos
   (`SUM(ventas CREDIT no anuladas) - SUM(abonos no anulados)`). Nunca confiar en un campo cacheado
   como fuente de verdad.
4. **Costo congelado**: al vender, copiar `unitCost` y `unitPrice` actuales al `SaleItem`.
   La ganancia histórica jamás se recalcula con precios nuevos.
5. **Multi-tenant**: TODO query de negocio filtra por `storeId` del JWT.
   Usar los helpers de `lib/db.ts` (que inyectan storeId); prohibido llamar
   `prisma.<model>.findMany` directo desde rutas sin pasar por el helper.
6. **Sync idempotente**: toda mutación creada offline lleva `clientId` (UUID v4 del dispositivo).
   El endpoint `/api/sync` hace upsert por `clientId`. Reintentar un lote debe ser inocuo.
7. **Zona horaria**: todo lo que sea "el día del tendero" (cierre de caja, ventas de hoy)
   se calcula en `America/Bogota`, no en UTC.

## Reglas de UX (NO negociables)
- Flujos críticos (registrar fiado, abono, venta) en ≤ 3 taps.
- Botones grandes (mín. 48px), tipografía grande, contraste alto — se usa de pie, con una mano.
- Lenguaje: "le fío", "me debe", "abonó", "gané hoy". Prohibida la jerga contable.
- Montos con teclado numérico nativo (`inputmode="numeric"`) y atajos ($1.000, $2.000, $5.000...).
- Todo funciona offline; mostrar indicador sutil de "pendiente de sincronizar", nunca bloquear.
- Español colombiano en toda la UI. Formato de moneda: $12.500 (punto de miles, sin decimales).

## Estructura del proyecto
```
app/
  (auth)/login/            # teléfono + PIN
  (app)/
    hoy/                   # dashboard del día (pantalla principal)
    fiados/                # lista clientes, detalle, nuevo fiado, abono
    ventas/                # registrar venta, historial
    productos/             # Fase 2
    estadisticas/          # Fase 2
    caja/                  # cierre de caja, Fase 2
  api/
    auth/
    sync/                  # endpoint único de sincronización por lotes
    ...
lib/
  db.ts                    # helpers Prisma con storeId inyectado
  auth.ts                  # JWT, middleware
  money.ts                 # formateo y aritmética de dinero
  dates.ts                 # helpers America/Bogota
offline/
  db.ts                    # esquema Dexie (espejo de modelos sync-ables)
  queue.ts                 # cola de sincronización + reintentos
  sync.ts                  # motor de sync (push por lotes, pull de cambios)
prisma/
  schema.prisma
docs/
  01-ESPECIFICACION.md
  04-ROADMAP.md
```

## Patrón de sincronización
1. UI escribe SIEMPRE primero en IndexedDB (optimista) y encola en `sync_queue`.
2. `sync.ts` corre al recuperar conexión y cada N segundos: `POST /api/sync`
   con lote `{ mutations: [{ model, clientId, payload, createdAtClient }] }`.
3. Servidor: transacción por lote, upsert por `clientId`, responde ids canónicos.
4. Pull: `GET /api/sync?since=<cursor>` devuelve cambios del servidor
   (para multi-dispositivo, Fase 3; en MVP el pull puede ser simple full-refresh por entidad).
5. Conflictos: movimientos son append-only (no hay conflicto);
   entidades editables (Customer, Product) → last-write-wins por `updatedAt`.

## Testing (mínimo obligatorio)
- Unit: cálculo de saldo de cliente, ganancia de venta, caja esperada del día (con TZ Bogotá).
- Integración: `/api/sync` idempotente (enviar el mismo lote 2 veces = mismo estado).
- Los tests de dinero usan Decimal, nunca comparación de floats.

## Comandos
```bash
npm run dev
npx prisma migrate dev
npx prisma studio
npm run test
npm run build
```

## Orden de implementación (Sprint 1 del roadmap)
1. Scaffold Next.js 15 + Tailwind + Prisma + schema + migración inicial.
2. Auth teléfono+PIN (registro de tienda, login, middleware JWT).
3. `lib/money.ts`, `lib/dates.ts`, `lib/db.ts` con tests.
4. CRUD Customer + registrar fiado + abono (online-first primero).
5. Pantalla "Hoy" + lista de fiados con saldos.
6. Capa offline (Dexie + queue + `/api/sync`) sobre lo anterior.
7. Deep link WhatsApp de recordatorio de cobro.
