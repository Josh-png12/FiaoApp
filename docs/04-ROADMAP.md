# Roadmap FiaoApp — Sprints de ~1 semana c/u

> Supuesto: 1 desarrollador (Joshua) + Claude Code, dedicación parcial junto a otros proyectos.
> Regla: NO empezar Fase 2 sin haber validado el MVP con tiendas reales.

## Sprint 0 — Validación en la calle (antes de programar en serio) · 3-4 días
- [ ] Visitar 5-8 tiendas en Riohacha con un mockup en el celular (puede ser Figma o HTML estático).
- [ ] Preguntas clave: ¿cómo llevas el fiado hoy? ¿cuánta plata crees que has perdido por fiado?
      ¿pagarías $20.000/mes por no perderla? ¿quién más atiende la tienda?
- [ ] Conseguir 3 tiendas piloto comprometidas (gratis 3 meses a cambio de feedback semanal).
- [ ] Decidir nombre y registrar dominio.
**Entregable:** 3 pilotos confirmados + aprendizajes que ajusten el MVP.

## Sprint 1 — Fundación técnica
- [ ] Scaffold: Next.js 15 + TS + Tailwind + Prisma + migración inicial del schema.
- [ ] Auth teléfono + PIN (registro de tienda, login, JWT httpOnly, middleware).
- [ ] Helpers core con tests: `money.ts`, `dates.ts` (TZ Bogotá), `db.ts` (storeId inyectado).
- [ ] Deploy base al VPS (PM2 + Nginx + dominio) desde el día 1 — deployar temprano, no al final.
**Entregable:** app vacía pero desplegada, con login funcionando en producción.

## Sprint 2 — Cuaderno de fiado (online-first)
- [ ] CRUD de clientes fiados (nombre, foto opcional, teléfono).
- [ ] Registrar fiado en ≤ 3 taps · registrar abono.
- [ ] Detalle de cliente: saldo + historial de movimientos.
- [ ] Pantalla "Hoy": total fiado del negocio, fiados/abonos del día.
- [ ] Deep link de recordatorio por WhatsApp con mensaje pre-armado.
**Entregable:** el cuaderno digital completo, usable con internet.

## Sprint 3 — Offline-first + ventas rápidas
- [ ] Capa Dexie/IndexedDB + cola de sync + `POST /api/sync` idempotente.
- [ ] Tests de idempotencia (mismo lote 2 veces = mismo estado).
- [ ] PWA instalable (manifest, service worker, ícono, splash).
- [ ] Venta rápida sin producto: monto + efectivo/fiado/Nequi.
- [ ] Indicador de sincronización pendiente.
**Entregable:** MVP completo → entregar a las 3 tiendas piloto. 🚀

## Sprint 4 — Piloto y hardening (2 semanas)
- [ ] Onboarding presencial con cada tienda; observar (no explicar de más).
- [ ] Canal de soporte por WhatsApp; visitas semanales.
- [ ] Corregir fricciones reales; medir retención D7 y movimientos/semana.
- [ ] Backup/restauración de cuenta (recuperar por teléfono+PIN en otro celular).
**Gate:** si retención D7 < 50% o no registran fiado a diario → iterar UX antes de seguir.

## Sprint 5-6 — Fase 2: productos y ganancias
- [ ] Catálogo de productos + categorías con margen estimado fallback.
- [ ] Entrada de inventario por lote (costo total + cantidad → costo unitario).
- [ ] Venta con productos (selector visual rápido) + costo congelado en SaleItem.
- [ ] Pantalla "Hoy" v2: ganancia estimada del día, comparación vs. ayer.

## Sprint 7 — Fase 2: cierre de caja + estadísticas
- [ ] Cierre de caja diario (esperado vs. contado, diferencia).
- [ ] Estadísticas: barras de ventas por día, margen del período, top vendidos / sin rotación,
      fiado nuevo vs. cobrado.
- [ ] Insights por reglas (frases accionables, mín. 5 reglas iniciales).

## Sprint 8+ — Fase 3 y monetización
- [ ] Multi-usuario con roles + turnos y cuadre por turno.
- [ ] Límite de fiado sugerido + antigüedad de deudas.
- [ ] Cuentas por pagar a proveedores.
- [ ] Activar cobro: plan FREE con límites + upgrade manual por Nequi/Daviplata.
- [ ] Salir a vender a 20-30 tiendas más con casos reales de los pilotos.

## Hitos de negocio
| Hito | Meta |
|---|---|
| 3 pilotos activos | Fin Sprint 3 |
| Retención D7 ≥ 50% | Fin Sprint 4 |
| Fase 2 en pilotos | Fin Sprint 7 |
| Primeros 10 clientes pagos | Sprint 10-12 |
