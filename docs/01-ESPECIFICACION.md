# FiaoApp — SaaS de gestión para tiendas de barrio
> Nombre provisional. Alternativas: "Cuaderno", "MiTienda", "Fiao", "TenderoApp".
> Producto de DeepSun Studio · Mercado inicial: Riohacha / La Guajira, Colombia

---

## 1. Visión

Reemplazar el cuaderno de papel del tendero con una app móvil (PWA offline-first) que gestione
**fiado, ventas, inventario, ganancias y cierre de caja**, en lenguaje de tendero (no de contador),
y que le diga en frases simples cómo va su negocio y qué decisiones tomar.

**Usuario objetivo:** dueño de tienda de barrio / minimercado en Riohacha. Usa el celular
detrás del mostrador, con una mano, con conectividad intermitente. Nunca ha usado software
de negocios. Su referencia mental es el cuaderno de fiado.

**Principios de producto (no negociables):**
1. Todo flujo crítico se completa en ≤ 3 taps.
2. Funciona 100% sin internet (registrar venta, fiado, abono) y sincroniza después.
3. Cero jerga contable: "le fío", "me debe", "abonó", "gané", nunca "cuentas por cobrar".
4. Mobile-first, iconos grandes, mínimo texto.

---

## 2. Alcance por fases

### Fase 1 — MVP: Cuaderno de fiado + ventas del día (validar con 3-5 tiendas)
- Auth por teléfono + PIN de 4 dígitos (el tendero no maneja emails).
- Clientes fiados: crear con nombre + foto opcional + teléfono.
- Registrar fiado en 2 taps: cliente → monto (+ nota opcional).
- Registrar abono (pago parcial o total).
- Saldo por cliente y saldo total fiado del negocio.
- Recordatorio de cobro por WhatsApp (deep link `wa.me` con mensaje pre-armado — sin API de pago en MVP).
- Registro rápido de venta del día: monto + tipo (efectivo / fiado). Sin producto obligatorio.
- Pantalla "Hoy": ventas del día (efectivo vs fiado), total fiado acumulado.
- Offline-first completo (IndexedDB + cola de sincronización).

### Fase 2 — Productos, ganancias y cierre de caja
- Catálogo de productos: nombre, precio de venta, costo, stock.
- Entrada de inventario por lote: costo total + cantidad → costo unitario automático.
- Venta con productos (selector visual rápido) → ganancia real calculada.
- Fallback de margen estimado por categoría cuando el tendero no sabe el costo.
- Cierre de caja diario: la app pregunta cuánto hay en caja y compara vs. esperado.
- Estadísticas: ventas por día (barras), margen del período, top 5 vendidos, top 5 sin rotación,
  fiado nuevo vs. cobrado.
- Insights automáticos por reglas (frases, no gráficas): margen bajó, deudor más antiguo,
  producto sin movimiento, stock por agotarse (según velocidad de venta).

### Fase 3 — Control y confianza
- Multi-usuario con roles: DUEÑO (todo) vs EMPLEADO (solo registra, no ve ganancias ni edita precios).
- Turnos: quién vendió qué, cuadre de caja por turno.
- Límite de fiado sugerido por cliente + score de confianza (historial de pago).
- Cuentas por pagar a proveedores (a quién le debe la tienda, fechas de vencimiento).
- Backup/restauración y recuperación de cuenta.

### Fase 4 — Red y expansión (post product-market fit)
- Comparación anónima con tiendas similares de la zona.
- Catálogo digital compartible por WhatsApp (reusar patrón de CatálogoApp).
- Marketplace de proveedores locales.
- Datos para micro-crédito (alianza fintech). Alerta compartida de morosos: **solo** con
  asesoría legal (Habeas Data / Ley 1581) — no antes.

---

## 3. Arquitectura

### Stack (alineado a lo que ya domina el equipo)
| Capa | Tecnología | Nota |
|---|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript + Tailwind | PWA con `next-pwa` o service worker manual |
| Offline | IndexedDB (Dexie.js) + cola de sync | Patrón ya probado en CRS (app iglesia) |
| Backend | API Routes de Next.js (monolito) | No separar backend en MVP; migrar a servicio aparte solo si hace falta |
| ORM/DB | Prisma + PostgreSQL | Neon en dev, Postgres local en VPS para prod |
| Auth | JWT propio (teléfono + PIN, bcrypt) en cookie httpOnly | NextAuth es sobredimensionado para phone+PIN |
| Deploy | VPS existente: PM2 + Nginx | Mismo pipeline canónico de SIEPA |
| Notificaciones | Deep links `wa.me` (MVP) → WhatsApp Cloud API (Fase 3+) | |

### Multi-tenancy
- **Una sola base de datos, `storeId` en todas las tablas de negocio** (row-level por aplicación).
- Trade-off: más simple de operar y migrar que schema-per-tenant; suficiente hasta miles de tiendas.
- Regla de oro: **ningún query sin filtro de `storeId`**. Centralizar en helpers/middleware de Prisma.
- Revisar a futuro: RLS nativo de Postgres si se abre acceso directo a la DB o crece el equipo.

### Sincronización offline (lo más delicado del sistema)
1. Cada operación creada en el cliente lleva un **UUID generado en el cliente** (`clientId`)
   y `createdAtClient` (timestamp local).
2. Se guarda en IndexedDB y se encola en `sync_queue`.
3. Al recuperar conexión, se envían en lotes a `POST /api/sync`.
4. El servidor hace **upsert por `clientId`** → reintentos idempotentes, sin duplicados.
5. Conflictos: modelo *append-only* para movimientos (fiados, abonos, ventas nunca se editan,
   solo se anulan con un movimiento inverso). Esto elimina el 95% de los conflictos de sync.
   Para entidades editables (producto, cliente): last-write-wins por `updatedAt`.
6. Los saldos **nunca se almacenan como verdad absoluta**: se derivan de movimientos
   (se puede cachear/desnormalizar, pero recalculable siempre).

### Decisiones clave de dominio
- **Congelar costo en la venta**: cada ítem vendido guarda `unitCost` del momento.
  Ganancia histórica nunca se distorsiona al cambiar precios.
- **Dinero en enteros (centavos COP) o `Decimal` de Prisma** — nunca `Float`.
- **Fiado = venta con `paymentType: CREDIT`** + movimiento en cuenta del cliente.
  Un abono es un `Payment` contra el saldo del cliente (no contra una venta específica,
  porque así funciona el cuaderno real: se abona "a la deuda", no a la compra del martes).

### Estimación de carga (tranquilidad)
Una tienda ≈ 100-300 movimientos/día. 500 tiendas ≈ 150k filas/día ≈ 4.5M/mes.
Postgres en un VPS modesto maneja esto sin despeinarse. No hay problema de escala en años.

---

## 4. Modelo de monetización
- **Freemium**: gratis hasta 30 clientes fiados y 1 usuario.
- **Plan Tienda** (~$20.000 COP/mes): clientes ilimitados, productos + ganancias, cierre de caja.
- **Plan Negocio** (~$40.000 COP/mes): multi-usuario, turnos, estadísticas completas, insights.
- Cobro por Nequi/Daviplata manual al inicio; Wompi recurrente cuando haya volumen.

---

## 5. Métricas de éxito del MVP
- Retención D7 ≥ 50% en las tiendas piloto (abren la app al menos 5 de 7 días).
- ≥ 10 movimientos de fiado registrados por tienda por semana.
- El tendero puede responder "¿cuánto te deben en total?" en < 5 segundos usando la app.

---

## 6. Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| Tendero abandona por fricción | Validar UX en papel/mockup con 3 tiendas ANTES de programar la Fase 2 |
| Pérdida del celular = pánico | Backup automático + recuperación por teléfono+PIN desde el día 1 |
| Sync genera duplicados/pérdidas | Idempotencia por clientId + append-only + tests de sync desde el sprint 1 |
| Datos personales de deudores | Política de privacidad simple; features de "red de morosos" solo con asesoría legal |
| Competidores (Treinta, etc.) | Foco hiperlocal: onboarding presencial en Riohacha, soporte por WhatsApp en persona |
