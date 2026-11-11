# Deuda de seguridad en dependencias

Estado según `npm audit` tras subir Next a 15.5.29 y Vitest a 3.2.7 (rama `chore/cimientos`).
Revisión obligatoria **antes del deploy al VPS**. No se ejecutó `npm audit fix` ni `--force`.

## Aplazadas por requerir salto de versión mayor

### Prisma 6.19.3 → 7.10.1 o superior
- Paquetes: `prisma`, `@prisma/config`, `deepmerge-ts` (severidad alta, `GHSA-ggr8-5vv4-36mx`).
- Problema: `deepmerge-ts` agota la pila al combinar grafos de objetos recursivos.
- Por qué es riesgo bajo hoy: solo se ejecuta al cargar la configuración del CLI de Prisma, con
  archivos que escribimos nosotros. No procesa datos de usuarios ni peticiones HTTP.
- Sin corrección dentro de 6.x (6.19.3 es la última).
- Cuándo: antes del deploy al VPS. Es un salto mayor que toca la capa de datos: hacerlo como tarea
  propia, con migraciones probadas en una base descartable.

### zod 3.25.x → 4.6.7 o superior
- Paquete: `zod` (severidad alta, `GHSA-mrhx-c7xc-m3w5`).
- Problema: consumo excesivo de memoria al validar colecciones muy grandes con restricciones.
- Por qué es riesgo bajo hoy: solo se usa en `app/api/auth/login` y `register`, con campos de texto,
  sin arrays ni colecciones. Además el body de las peticiones tiene un tamaño acotado.
- Sin corrección dentro de 3.x.
- Cuándo: antes del deploy al VPS. Aprovechar el endurecimiento de autenticación (Prompt 3) o el
  Sprint 1, cuando se agreguen validadores nuevos, para migrar una sola vez.

## Pendientes menores (sin salto mayor, pero no aplicados por alcance)

- `postcss` anidado en Next (`GHSA-qx2v-qp2m-jg93`, `GHSA-6g55-p6wh-862q`, `GHSA-fxqj-rqcc-2cmp`,
  `GHSA-r28c-9q8g-f849`): solo se corrige con Next 16. Es de build; no procesa CSS de usuarios.
- `sharp`, `nanoid`, `source-map-js`, `vite`, `minimatch` y `@typescript-eslint/*`: tienen corrección
  sin salto mayor, pero requieren actualizar esos paquetes de forma explícita. Revisar antes del deploy.
- `vitest`, `@vitest/mocker`, `tinypool` (dev; una crítica): la corrección completa pide Vitest 5.x.
  Solo afecta a quien ejecuta los tests con código o configuración hostil.
