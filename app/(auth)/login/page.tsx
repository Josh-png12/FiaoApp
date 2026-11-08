"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo entrar. Intenta de nuevo.");
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
      <div className="mb-10 text-center">
        <div className="text-5xl">📒</div>
        <h1 className="mt-3 text-3xl font-black">FiaoApp</h1>
        <p className="mt-1 text-stone-500">El cuaderno de tu tienda</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="block">
          <span className="mb-1 block font-bold">Tu celular</span>
          <input
            className="input-big"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="300 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-bold">Tu clave (PIN)</span>
          <input
            className="input-big tracking-[0.5em]"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            placeholder="••••"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            required
          />
        </label>

        {error && (
          <p className="rounded-xl bg-red-50 p-3 text-center font-bold text-debt">
            {error}
          </p>
        )}

        <button className="btn btn-primary" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>

      <p className="mt-8 text-center text-stone-600">
        ¿Primera vez?{" "}
        <Link href="/registro" className="font-bold text-brand underline">
          Crea tu tienda gratis
        </Link>
      </p>
    </main>
  );
}
