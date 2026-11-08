"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegistroPage() {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName, ownerName, phone, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo crear la tienda.");
        return;
      }
      router.push("/hoy");
      router.refresh();
    } catch {
      setError("Sin conexión. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 py-10">
      <h1 className="mb-1 text-3xl font-black">Crea tu tienda</h1>
      <p className="mb-8 text-stone-500">Gratis. Solo necesitas tu celular.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="block">
          <span className="mb-1 block font-bold">Nombre de tu tienda</span>
          <input
            className="input-big"
            placeholder="Tienda Doña Rosa"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            required
            minLength={2}
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-bold">Tu nombre</span>
          <input
            className="input-big"
            placeholder="Rosa Pérez"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            required
            minLength={2}
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-bold">Tu celular</span>
          <input
            className="input-big"
            type="tel"
            inputMode="tel"
            placeholder="300 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-bold">
            Inventa una clave (4 a 6 números)
          </span>
          <input
            className="input-big tracking-[0.5em]"
            type="password"
            inputMode="numeric"
            placeholder="••••"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            required
            minLength={4}
          />
          <span className="mt-1 block text-sm text-stone-500">
            Con esta clave entras a la app. No la compartas.
          </span>
        </label>

        {error && (
          <p className="rounded-xl bg-red-50 p-3 text-center font-bold text-debt">
            {error}
          </p>
        )}

        <button className="btn btn-primary" disabled={loading}>
          {loading ? "Creando..." : "Crear mi tienda"}
        </button>
      </form>

      <p className="mt-8 text-center text-stone-600">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-bold text-brand underline">
          Entra aquí
        </Link>
      </p>
    </main>
  );
}
