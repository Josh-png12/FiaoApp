// Pantalla "Hoy" — lo primero que ve el tendero al abrir la app.
// Responde en < 5 segundos: ¿cuánto vendí hoy? ¿cuánto me deben en total?
import { getSession } from "@/lib/auth";
import { storeDb } from "@/lib/db";
import { formatCOP, money, ZERO } from "@/lib/money";
import { bogotaDayRange, formatBogotaDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function HoyPage() {
  const session = (await getSession())!; // layout ya validó
  const db = storeDb(session.storeId);
  const hoy = bogotaDayRange();

  const [ventasHoy, fiadoHoy, fiadoTotal, abonosTotal, abonosHoy] =
    await Promise.all([
      // Vendido hoy en efectivo/Nequi/Daviplata (no fiado)
      db.sale.aggregate({
        _sum: { total: true },
        where: { soldAt: hoy, voidedAt: null, paymentType: { not: "CREDIT" } },
      }),
      // Fiado entregado hoy
      db.sale.aggregate({
        _sum: { total: true },
        where: { soldAt: hoy, voidedAt: null, paymentType: "CREDIT" },
      }),
      // Total histórico fiado (para saldo total)
      db.sale.aggregate({
        _sum: { total: true },
        where: { voidedAt: null, paymentType: "CREDIT" },
      }),
      db.payment.aggregate({
        _sum: { amount: true },
        where: { voidedAt: null },
      }),
      db.payment.aggregate({
        _sum: { amount: true },
        where: { voidedAt: null, paidAt: hoy },
      }),
    ]);

  const vendidoHoy = money(ventasHoy._sum?.total?.toString() ?? 0);
  const fiadoDeHoy = money(fiadoHoy._sum?.total?.toString() ?? 0);
  const cobradoHoy = money(abonosHoy._sum?.amount?.toString() ?? 0);
  // Saldo derivado de movimientos — nunca un campo cacheado (regla de dominio)
  const meDeben = money(fiadoTotal._sum?.total?.toString() ?? 0).minus(
    money(abonosTotal._sum?.amount?.toString() ?? 0)
  );

  return (
    <main className="px-5 pt-6">
      <p className="text-stone-500 first-letter:uppercase">
        {formatBogotaDate()}
      </p>
      <h1 className="mb-6 text-2xl font-black">Hola, {session.name} 👋</h1>

      {/* Lo más importante primero: cuánto me deben */}
      <section className="mb-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
        <p className="font-bold text-stone-500">Me deben en total</p>
        <p className="text-4xl font-black text-debt">
          {formatCOP(meDeben.greaterThan(ZERO) ? meDeben : ZERO)}
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-sm font-bold text-stone-500">Vendí hoy</p>
          <p className="text-2xl font-black text-brand">
            {formatCOP(vendidoHoy)}
          </p>
        </div>
        <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-sm font-bold text-stone-500">Fié hoy</p>
          <p className="text-2xl font-black">{formatCOP(fiadoDeHoy)}</p>
        </div>
        <div className="col-span-2 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-sm font-bold text-stone-500">Me abonaron hoy</p>
          <p className="text-2xl font-black text-brand">
            {formatCOP(cobradoHoy)}
          </p>
        </div>
      </section>

      {/* Acciones rápidas (Sprint 2 les da vida) */}
      <section className="mt-6 flex flex-col gap-3">
        <a href="/fiados" className="btn btn-primary">
          📒 Anotar fiado
        </a>
        <a href="/ventas" className="btn btn-secondary">
          💵 Anotar venta
        </a>
      </section>
    </main>
  );
}
