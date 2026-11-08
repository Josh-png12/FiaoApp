import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FiaoApp — El cuaderno de tu tienda",
  description:
    "Fiado, ventas y ganancias de tu tienda, sin cuaderno y sin enredos.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // evita zoom accidental al tocar inputs
  themeColor: "#16a34a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-CO">
      <body>
        <div className="mx-auto min-h-dvh max-w-md">{children}</div>
      </body>
    </html>
  );
}
