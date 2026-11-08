import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1 pb-24">{children}</div>

      {/* Navegación inferior: pulgar de una mano */}
      <nav className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-stone-200 bg-white">
        <div className="grid grid-cols-3">
          <Link
            href="/hoy"
            className="flex min-h-16 flex-col items-center justify-center gap-0.5 font-bold"
          >
            <span className="text-2xl">🏠</span>
            <span className="text-xs">Hoy</span>
          </Link>
          <Link
            href="/fiados"
            className="flex min-h-16 flex-col items-center justify-center gap-0.5 font-bold"
          >
            <span className="text-2xl">📒</span>
            <span className="text-xs">Fiados</span>
          </Link>
          <Link
            href="/ventas"
            className="flex min-h-16 flex-col items-center justify-center gap-0.5 font-bold"
          >
            <span className="text-2xl">💵</span>
            <span className="text-xs">Ventas</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
