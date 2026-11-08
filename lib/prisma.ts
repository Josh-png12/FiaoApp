// Singleton lazy de PrismaClient.
// Lazy: no se instancia al importar el módulo, sino al primer uso real.
// Esto permite testear helpers puros (lib/db.ts) sin base de datos,
// y evita instancias duplicadas con el HMR de Next.js en dev.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient();
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = client[prop as keyof PrismaClient];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
