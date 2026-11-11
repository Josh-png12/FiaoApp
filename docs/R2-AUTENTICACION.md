# R2 — Autenticación, roles y sesiones (documento de DISEÑO)

Estado: **diseño cerrado: todas las decisiones están aprobadas (§11).** Se implementa por pasos (§9); el progreso se ve en `git log`.
Rama: `feat/r2-autenticacion` (sale de `feat/r1-aislamiento-tienda`, ya commiteada).
Convención: **DECIDIDO / APROBADA** = decisión tuya incorporada. Ya no queda ningún punto **[DECIDIR]** abierto (resumen en §11).

---

## 0. Decisiones de producto ya tomadas (no se reabren)

- Modelo híbrido: 1 OWNER obligatorio por tienda + EMPLEADOS opcionales (rol `EMPLOYEE`) con PIN propio.
- El OWNER crea, desactiva y resetea el PIN de empleados.
- EMPLOYEE puede registrar ventas, fiados y abonos, y ver clientes y saldos. NO puede anular, cambiar precios,
  archivar clientes, ver estadísticas de ganancias, administrar empleados ni cambiar la configuración de la tienda.
- Cada `Sale` y `Payment` guarda quién lo registró (`createdByUserId`) y, al anular, quién (`voidedByUserId`).
- OWNER entra con celular + PIN. EMPLOYEE entra con código corto de tienda + usuario + PIN (puede no tener celular).
- Desactivar un empleado cierra sus sesiones de inmediato.

---

## 1. Estado actual del código (descrito tal cual está)

**Sesión (`lib/auth.ts`)**
- JWT HS256 con `jose`, cookie `fiao_session` (`httpOnly`, `sameSite: lax`, `secure` solo si `NODE_ENV=production`, `path=/`).
- Vigencia fija de **90 días, sin renovación y sin forma de revocar**. El token lleva `userId`, `storeId`, `role` y `name`.
- `getSession()` solo verifica la firma y la expiración. **No consulta la BD**: un usuario desactivado, o con rol cambiado,
  sigue entrando hasta que el token venza. Hoy `role` y `name` se confían desde el token.
- `normalizePhone` (celular colombiano, admite `+57`) e `isValidPin` (`/^\d{4,6}$/`). No hay lista de PIN triviales.
- `JWT_SECRET` solo se valida como "existe"; no hay largo mínimo.

**Middleware (`middleware.ts`)**
- Corre en Edge. Verifica la firma del token; redirige a `/login` (páginas) o responde 401 (`/api`).
- `PUBLIC_PATHS` se compara con `startsWith`, así que `/login-cualquier-cosa` también queda público.
- No chequea rol, no revisa `Origin` (CSRF) y no renueva el token.

**Rutas de auth (`app/api/auth/{register,login,logout}`)**
- `register`: valida con zod, comprueba `findUnique({phone})` y después crea (carrera: dos registros simultáneos con el
  mismo celular terminan en un 500 por `P2002`, no en un 409). Hashea con `bcryptjs` costo 10. Crea Store + User OWNER.
- `login`: mismo mensaje de error para todo, pero si el celular no existe **no hace `bcrypt.compare`**, por lo que la
  respuesta es más rápida (se puede detectar por tiempo qué celulares están registrados). **No hay límite de intentos.**
  Hoy un PIN de 4 dígitos (10.000 combinaciones) se puede adivinar probando sin freno.
- `logout`: solo borra la cookie.
- Estas rutas importan `@/lib/prisma` directo (excepción temporal del ESLint de R1; este diseño la retira).

**Modelo (`prisma/schema.prisma`, con R1 aplicado)**
- `User`: `phone String @unique` (obligatorio y único **global**), `pinHash`, `role Role @default(OWNER)`, `isActive`,
  `@@unique([id, storeId])`. No tiene `username`, ni forma de invalidar sesiones, ni auditoría.
- `Store`: `phone @unique`, `isActive`. No tiene código de tienda.
- `Sale.userId` y `Payment.userId`: **ya existen**, opcionales, con FK compuesta `(userId, storeId)`; hoy significan
  "quién lo registró" pero pueden ser NULL. `voidedAt` existe en `Sale`, `Payment` y `StockEntry`, sin "quién anuló".
- `CashClosing.userId` existe (opcional).

**Uso de sesión y `storeDb`**
- `getSession()` se llama solo en `app/(app)/layout.tsx` y en `app/(app)/hoy/page.tsx` (con `!`).
- `storeDb(storeId)` solo lo usa `hoy/page.tsx` (agregados de venta y abono). **No existen aún rutas de negocio**
  (`/fiados`, `/ventas` son placeholders), así que el control de acceso se puede construir bien desde el principio.
- La barra de navegación no distingue roles.

---

## 2. Modelo de datos

### 2.1 Cambios en `User`
| Campo | Cambio | Motivo |
|---|---|---|
| `phone` | `String?` (nullable), sigue `@unique` | Empleados sin celular. Postgres permite varios NULL en un índice único. |
| `username` | `String?`, `@@unique([storeId, username])` | Login de empleado. Se guarda en minúsculas; 3–20 caracteres `[a-z0-9._]`. |
| `role` | ya existe (`OWNER`/`EMPLOYEE`) | Se deja de leer del token; se lee de la BD. |
| `isActive` | ya existe | Se complementa con `deactivatedAt DateTime?` (auditoría y regla de sync, §6.4). |
| `tokenVersion` | `Int @default(0)` | Revocación de sesiones (§2.3). |
| `mustChangePin` | `Boolean @default(false)` | PIN temporal tras alta o reseteo por el OWNER. |
| `pinChangedAt` | `DateTime?` | Auditoría y futura política de rotación. |
| `pinHashVersion` | `Int @default(1)` | Versión del esquema de hash del PIN (1 = bcrypt sin pepper; ≥ 2 = bcrypt sobre HMAC con pepper). Permite rotar el pepper (§2.6). |
| `lastLoginAt` | `DateTime?` | El OWNER ve "último acceso" de cada empleado. |

CHECK (SQL manual en la migración, como en R1):
- `role = 'OWNER'` ⇒ `phone IS NOT NULL`.
- `role = 'EMPLOYEE'` ⇒ `username IS NOT NULL`.
- Índice único parcial: `CREATE UNIQUE INDEX ... ON "User"("storeId") WHERE "role" = 'OWNER'` ⇒ exactamente un OWNER por tienda
  (el "obligatorio" lo garantiza el registro, que crea tienda y OWNER en una transacción).

> Riesgo técnico a verificar en el paso 1: Prisma no modela índices parciales; hay que comprobar con
> `migrate diff` y `migrate status` que no intente borrarlo. Si lo intenta, se documenta y se deja el índice fuera
> del schema con un test de integración que verifique que existe.

**D4 · DECIDIDO (se acepta lo propuesto). Celular de empleados.** `phone` queda único **global**. Consecuencia: una persona no puede ser dueña de la
tienda A y empleada de la B con el mismo celular. Se acepta en el MVP (cero SQL no modelable, y el
celular del empleado es opcional). La alternativa, un índice parcial `UNIQUE(phone) WHERE role='OWNER'`, resuelve el caso
pero complica el login por celular (hay que filtrar por rol) y el schema.

### 2.2 Código de tienda
- `Store.code String @unique`, **6 caracteres** del alfabeto `23456789ABCDEFGHJKMNPQRSTVWXYZ`
  (30 símbolos: sin `0 O 1 I L U`, que se confunden al leer o dictar). Espacio: 30⁶ ≈ 729 millones.
- Se muestra con guion: `K7M-4QX`. Al escribirlo se normaliza (mayúsculas, sin espacios ni guion).
- Se genera con `crypto.randomInt` (no secuencial, no adivinable por orden). Si choca (`P2002`), se reintenta hasta 5 veces.
- **No es un secreto**: identifica la tienda; la seguridad está en usuario + PIN + límite de intentos. El error de login
  no revela si el código existe.
- Migración: columna nullable, relleno con un bloque `DO $$` (genera con la misma regla y reintenta ante choque),
  luego `NOT NULL` + `UNIQUE`.

**D3 · DECIDIDO: 6 caracteres.** Con 5 (24 millones) también alcanza para años de tiendas, y es más corto de dictar;
subir a 6 cuesta poco y deja margen contra enumeración.

### 2.3 Revocación de sesiones: comparación y recomendación

| | **A. `tokenVersion` en `User`** | **B. Tabla `Session` (una fila por sesión)** |
|---|---|---|
| Qué lleva el token | `sub`, `sid` (storeId), `tv` | `sub`, `sid`, `jti` (id de sesión) |
| Chequeo por request | 1 `SELECT` por PK a `User` (+ `Store.isActive`) | 1 `SELECT` a `Session` + `User` + `Store` |
| Desactivar empleado | `UPDATE User SET isActive=false, tokenVersion=tokenVersion+1` → todas sus sesiones mueren | Revocar todas sus filas de `Session` |
| Cerrar solo ESTE dispositivo | **No** (logout borra la cookie, el token robado seguiría vivo hasta vencer) | Sí |
| "Cerrar sesión en todos mis dispositivos" | Sí (`tv+1`) | Sí |
| Escrituras en Neon | Ninguna en uso normal | `lastSeenAt` (se puede espaciar) + limpieza de filas vencidas |
| Piezas extra | Ninguna | Tabla, índices, job de limpieza, pantalla de sesiones |
| Complejidad | Baja | Media |

Ambas necesitan una lectura a BD por request autenticada (el middleware en Edge **no** puede usar Prisma; solo valida
firma). Una lectura por PK es del orden de unos pocos ms con la BD "caliente". El costo real en Neon free es el
arranque tras autosuspensión (cientos de ms en la primera consulta tras inactividad): **no lo medí** y lo mediré en el
paso 2. Ese costo es igual en A y en B, y como la app solo se usa con el negocio abierto, la BD ya estará despierta.

**Recomiendo A (`tokenVersion`)**: cero escrituras en uso normal, una sola lectura (la misma que necesitamos de todos modos
para leer rol, `isActive` y estado de la tienda), y cubre los dos casos críticos de tu decisión: empleado desactivado y
celular perdido. Lo que cede es el logout "solo este dispositivo" con invalidación real; para un cookie `httpOnly` eso
requiere tener el dispositivo, y el dueño siempre puede usar "cerrar todas". Si más adelante hace falta ver y cerrar
dispositivos uno por uno, se migra a B sin tocar el contrato (`getSession()` sigue igual).
No recomiendo un caché en memoria de la verificación: con PM2 en modo cluster rompería el "de inmediato".

**D1 · DECIDIDO: opción A (`tokenVersion`).** `tokenVersion` **sube** en cada uno de estos eventos, cada uno con su `AuthEvent`:
1. Desactivar a un empleado (en la misma sentencia que `isActive=false`).
2. Cambiar el PIN propio (cierra las demás sesiones; la actual se reemite con el valor nuevo).
3. Resetear el PIN de un empleado (lo hace el OWNER).
4. **"Cerrar sesión en todos los dispositivos"** (botón en Ajustes, para OWNER y EMPLOYEE sobre su propia cuenta).
5. Reactivar a un empleado.

El **logout normal solo borra la cookie** del dispositivo y no toca `tokenVersion` (D1b, decidido).
Consecuencia aceptada: un token robado de un dispositivo donde se hizo logout sigue válido hasta su vencimiento o hasta que
ocurra alguno de los cinco eventos; por eso "cerrar todas" existe y se explica en Ajustes.

### 2.4 Autoría y anulación
- `Sale.userId` y `Payment.userId` pasan a llamarse **`createdByUserId`** con `RENAME COLUMN` (más renombrar la FK compuesta y los
  índices que la incluyan): solo metadatos, reversible, sin columna duplicada (ver D8 abajo). En Prisma, `User` queda con dos relaciones
  hacia `Sale`/`Payment` (quien creó y quien anuló), así que se nombran (`@relation("SaleCreatedBy")`, `@relation("SaleVoidedBy")`, ídem `Payment`).
- Obligatorio hacia adelante, **sin inventar historia**: los registros anteriores con NULL se dejan en NULL ("autor
  desconocido, anterior a R2") y se agrega `CHECK ("createdByUserId" IS NOT NULL) NOT VALID`: Postgres lo exige a toda fila
  nueva o modificada y no revisa las existentes. `VALIDATE` queda para cuando no haya NULL.
- `voidedByUserId` (nullable) en `Sale`, `Payment` y `StockEntry`, con FK compuesta `(voidedByUserId, storeId)` igual que
  R1 (Restrict) y `CHECK ((voidedAt IS NULL) = (voidedByUserId IS NULL))`.
- `storeDb` cambia a `storeDb({ storeId, userId })`: el `create` de venta/abono **inyecta** `createdByUserId`
  (igual que `storeId`; `assertScalarData` rechaza que venga en `data`) y `void(id)` fija `voidedAt` y `voidedByUserId`.
  El cliente nunca decide quién es el autor.

**D8 · DECIDIDO (con cambios): `RENAME COLUMN` escrito a mano, nunca drop + add.** Procedimiento:
1. Generar el SQL con `prisma migrate diff` (saldrá como `DROP COLUMN` + `ADD COLUMN`).
2. **Leerlo** y reemplazar esas sentencias por `ALTER TABLE ... RENAME COLUMN "userId" TO "createdByUserId"`, más el renombre de la FK
   compuesta (`Sale_userId_storeId_fkey` → `Sale_createdByUserId_storeId_fkey`, ídem `Payment`) y de cualquier índice que incluya la
   columna (`RENAME CONSTRAINT` / `ALTER INDEX ... RENAME TO`), de forma que un `migrate diff` posterior contra el schema salga **vacío**.
3. En dev, contar filas **antes y después** (totales de `Sale` y `Payment`, y cuántas tienen autor no nulo): deben ser idénticas.
4. El CHECK de autoría `NOT NULL` va `NOT VALID`: solo exige autor a filas nuevas o modificadas; el histórico no se toca ni se inventa.

### 2.5 Tablas nuevas
```
RateLimit  { key String @id, fails Int, strikes Int, windowStart DateTime, lockedUntil DateTime?, updatedAt DateTime }
AuthEvent  { id, createdAt, type AuthEventType, storeId String?, userId String?, ok Boolean,
             ipHash String?, userAgent String? (recortado a 120), meta Json? }
```
Sin FK en `AuthEvent.userId`/`storeId` hacia el aislamiento estricto: se guardan como referencia lógica (un evento de login
fallido no tiene usuario). Append-only: la app solo hace `INSERT`.

### 2.6 Hash del PIN: pepper y versión (D9, adelantado al paso 3)
- Esquema v≥2: `bcrypt( base64( HMAC-SHA256( pepper_vN, pin ) ), costo 10 )`. Sin el pepper, una BD filtrada no sirve para probar los
  10⁴–10⁶ PIN posibles. La salida del HMAC en base64 (44 caracteres) cabe en el límite de 72 bytes de bcrypt.
- `User.pinHashVersion` guarda la versión: **1 = bcrypt sin pepper** (los hashes actuales), 2, 3… = pepper N. Para **rotar**: se agrega
  `PIN_PEPPER_V3`, se sube `PIN_PEPPER_CURRENT_VERSION=3`, y cada usuario se re-hashea solo al iniciar sesión (se verifica con su versión
  y, si es menor que la vigente, se recalcula y se guarda). Los hashes v1 existentes siguen entrando y se actualizan en su próximo login.
- El pepper vive en variables de entorno **distintas de `JWT_SECRET`**: `PIN_PEPPER_V2` (≥ 32 bytes aleatorios) y
  `PIN_PEPPER_CURRENT_VERSION`. `.env.example` trae placeholders con el comando para generarlos; **nunca se commitean valores reales**.
- **En producción la app no arranca si falta** el pepper vigente o es corto (comprobación al iniciar, en `lib/env.ts` invocado desde
  `instrumentation.ts`). En desarrollo y pruebas se usa un valor fijo de desarrollo, con advertencia.
- El `bcrypt.compare` simulado (usuario inexistente) usa un hash de la versión vigente para que el tiempo sea comparable.
- Riesgo operativo: **si se pierde el pepper nadie puede iniciar sesión** (habría que resetear todos los PIN). Se guarda en el gestor de
  contraseñas y en las variables del VPS; en una rotación se conservan los peppers anteriores mientras queden usuarios en esa versión.

---

## 3. Flujos

**3.1 Registro de tienda (OWNER)** — `POST /api/auth/register`
1. Límite por IP (§5). 2. Validar (zod), `normalizePhone`, política de PIN (§5.1). 3. Calcular el hash del PIN (HMAC con pepper y luego `bcrypt`, §2.6) **fuera** de la transacción.
4. Transacción: crear `Store` (con código, reintento ante `P2002`) + `User` OWNER. `P2002` en `phone` ⇒ 409 (hoy es un 500
por carrera). 5. `AuthEvent STORE_REGISTERED`. 6. Firmar token con `tv=0`, poner cookie.
7. La pantalla de éxito muestra el código de la tienda ("Este es el código para tus empleados"); queda visible en Ajustes.

**3.2 Login OWNER** — celular + PIN
1. Revisar los bloqueos de §5.2 (cuenta+IP, cuenta, IP). Si está bloqueada ⇒ 429 genérico (se bloquea
igual exista o no la cuenta, para no revelar existencia). 2. Buscar `User` por `phone`. 3. **Siempre** hacer la verificación del PIN (HMAC + `bcrypt.compare`); si el celular no existe, se compara contra un hash simulado de la versión vigente, para no filtrar qué celulares están registrados. 4. Si falla, o si `isActive` / `Store.isActive` es falso ⇒
mismo mensaje "Celular o PIN incorrecto", cuenta el intento. 5. Si pasa: limpiar contadores, re-hashear si la versión del hash es anterior a la vigente (§2.6), `lastLoginAt`, `AuthEvent LOGIN_OK`,
token con el `tokenVersion` actual, cookie.

**3.3 Login EMPLOYEE** — código de tienda + usuario + PIN
Igual que 3.2 con identificador de cuenta `emp:<código>:<usuario>` (§5.2); este flujo se implementa en el paso 4; se busca la tienda por código y el usuario por
`(storeId, username)`. La UI trae un interruptor "Entro como empleado". Si `mustChangePin` es verdadero, la sesión solo
permite la acción `pin.change` (se aplica en el envoltorio de rutas, §4.2) hasta que el empleado elija su PIN.

**3.4 Logout** — borra la cookie y registra `LOGOUT`. No sube `tokenVersion`.
Aparte, "Cerrar sesión en todos mis dispositivos" sube `tokenVersion`, registra `SESSIONS_REVOKED` y reemite la cookie
del dispositivo actual.

**3.5 Cambio de PIN propio** — pide PIN actual + nuevo (con la política de §5.1). Sube `tokenVersion` (cierra las otras
sesiones), reemite la cookie actual, limpia `mustChangePin`, `AuthEvent PIN_CHANGED`.

**3.6 Reseteo de PIN de empleado (OWNER)** — el sistema genera un PIN temporal aleatorio de 6 dígitos (válido según la
política), lo muestra **una sola vez**, pone `mustChangePin=true`, sube `tokenVersion` y registra `PIN_RESET_BY_OWNER`.
El OWNER también puede desbloquear la cuenta de un empleado (borra su fila de `RateLimit`).
**D6 · DECIDIDO:** PIN temporal generado + cambio obligatorio: el dueño nunca conoce el PIN definitivo del empleado,
y la autoría de cada venta queda defendible. La alternativa (el dueño elige el PIN) es más simple pero le permite
actuar "como" el empleado.

**3.7 Alta de empleado (OWNER)** — nombre, usuario (único en la tienda), celular opcional. Genera PIN temporal igual que 3.6
(`mustChangePin=true`). `AuthEvent EMPLOYEE_CREATED`.

**3.8 Baja de empleado (OWNER)** — `isActive=false`, `deactivatedAt=now()`, `tokenVersion+1` en la misma sentencia
(efecto inmediato en la siguiente request). `AuthEvent EMPLOYEE_DEACTIVATED`. Nunca se borra: las FK de R1 son Restrict y
sus ventas siguen atribuidas. Reactivar es posible y exige PIN nuevo. El OWNER no puede desactivarse a sí mismo.

---

## 4. Sesión y autorización

### 4.1 Token y cookie
- Token mínimo: `sub` (userId), `sid` (storeId), `tv` (tokenVersion), `iat`, `exp`. Se **elimina `role` y `name`** del token:
  el rol sale siempre de la BD, así un cambio de rol o una baja aplican al instante.
- **Duración (D2 · DECIDIDO)**: 30 días con renovación deslizante (se reemite cuando el token tiene más de 7 días
  de antigüedad; lo hace el middleware, que sí puede escribir cookies) y tope absoluto de 90 días desde el último login
  (claim `auth_at`). Con la revocación en BD ya no hay que usar 90 días fijos "por si acaso".
- Cookie: `httpOnly`, `secure` en producción, `path=/`. En producción el nombre es `__Host-fiao_session` (obliga `Secure`,
  `Path=/` y sin `Domain`); en desarrollo `fiao_session` (por `http://localhost`).
- **`sameSite=lax` se mantiene** (no `strict`): los enlaces que abren la app desde WhatsApp son navegaciones externas y con
  `strict` llegarían sin sesión. La defensa CSRF es `lax` + verificación del `Origin`/`Host` en todo `POST/PUT/PATCH/DELETE`
  de `/api` (en el middleware).
- Al arrancar: `JWT_SECRET` debe tener al menos 32 bytes, si no, falla fuerte.
- Con el cambio, los tokens actuales (sin `tv`) quedan inválidos: todos vuelven a entrar una vez. **D11 · DECIDIDO:** se acepta (hoy hay 2 usuarios en dev, y evita confiar en `role` del token viejo).

### 4.2 Reparto de responsabilidades

| Capa | Hace | No hace |
|---|---|---|
| **Middleware (Edge)** | Verifica firma y expiración, redirige o responde 401, renueva el token, revisa `Origin`, deja pasar solo las rutas públicas con comparación exacta | Consultar la BD, decidir roles |
| **`getSession()` (Node)** | 1 consulta por PK: `User` + `Store.isActive`; compara `tv`, `isActive`; devuelve `{userId, storeId, role, name, mustChangePin}` con datos **de la BD**. Cacheada por request con `React.cache` | Confiar en el contenido del token |
| **Cada ruta** | Pasa por el envoltorio `route()` (abajo) | Leer cookies o `storeId` por su cuenta |

### 4.3 Autorización central
Archivo `lib/authz.ts`:
```ts
type Action = "sale.create" | "sale.void" | "payment.create" | "payment.void" | "customer.read" | ...
const PERMISSIONS: Record<Action, readonly Role[]> = { ... };   // la matriz, una sola fuente
export const can = (role: Role, action: Action) => PERMISSIONS[action].includes(role);
```
Y un envoltorio obligatorio para las rutas:
```ts
export const POST = route("sale.void", async (ctx, req) => { /* ctx.db = storeDb({storeId, userId}) */ });
export const GET  = publicRoute(async (req) => { ... });   // solo login/register
```
`route()` hace: `getSession()` → 401 si no hay; bloquea todo salvo `pin.change` si `mustChangePin`; `can(role, action)` → 403 si no;
inyecta `ctx` con `db` ya ligado a la tienda y al usuario. `ctx` es lo único que ve el handler.

**Matriz acción × rol** (propuesta; los puntos con ? son decisión tuya):

| Acción | OWNER | EMPLOYEE |
|---|:-:|:-:|
| Registrar venta / fiado (`sale.create`) | ✅ | ✅ |
| Registrar abono (`payment.create`) | ✅ | ✅ |
| Ver clientes y saldos (`customer.read`) | ✅ | ✅ |
| Crear cliente nuevo (`customer.create`) | ✅ | ✅ ? |
| Editar datos de un cliente (`customer.update`) | ✅ | ❌ ? |
| Archivar cliente (`customer.archive`) | ✅ | ❌ |
| Anular venta o abono (`sale.void`, `payment.void`) | ✅ | ❌ |
| Ver productos / precios (`product.read`) | ✅ | ✅ |
| Cambiar precios, crear/editar productos (`product.write`) | ✅ | ❌ |
| Registrar entrada de inventario / proveedores (`stock.write`) | ✅ | ❌ ? |
| Ver ganancias y estadísticas (`stats.profit.read`) | ✅ | ❌ |
| Resumen de "Hoy" (ventas y cobros del día) (`today.read`) | ✅ completo | ✅ solo lo registrado por él, sin ganancia ? |
| Cierre de caja (`cash.close`) | ✅ | ❌ ? |
| Administrar empleados y PIN (`employee.manage`) | ✅ | ❌ |
| Ajustes de la tienda (`store.settings`) | ✅ | ❌ |
| Cambiar mi propio PIN / cerrar mis sesiones (`pin.change`, `session.revoke`) | ✅ | ✅ |

**D5 · DECIDIDO (como se propuso).** Los puntos con `?` quedan así: el empleado **crea** clientes (sin eso no puede fiar a alguien nuevo) pero no los
edita ni archiva; no registra entradas de inventario; ve "Hoy" solo con lo que él registró y sin ganancia; el cierre de caja es
del OWNER en la v1. Si el empleado necesita hacer el cierre, se agrega la acción sin tocar el modelo.

### 4.4 Cómo evitar que una ruta nueva olvide el chequeo (defensa en capas)
1. **ESLint**: en `app/api/**/route.ts` se prohíbe exportar `GET/POST/PUT/PATCH/DELETE` como funciones; solo
   `export const X = route(...)` o `publicRoute(...)` (regla `no-restricted-syntax`). `publicRoute` solo se permite en una lista corta
   de archivos (login y register), también por regla.
2. **Test de cobertura**: recorre `app/api/**/route.ts` y falla si algún método exportado no está envuelto, si la acción no
   existe en `PERMISSIONS`, o si hay una acción en la matriz que ninguna ruta usa y no está marcada como "solo UI".
3. **Páginas de servidor**: las pantallas solo-OWNER (estadísticas, empleados, ajustes) llaman `requirePageCan(action)` (redirige
   a `/hoy`). Ocultar el botón en la UI es comodidad, nunca seguridad.
4. **Aislamiento ya garantizado por R1** (FK compuestas + `storeDb`): un fallo de rol no cruza tiendas.

---

## 5. Fuerza bruta y política de PIN

### 5.1 PIN
- Largo **4 a 6 dígitos** (se mantiene). **D7 · DECIDIDO:** se mantiene 4–6: un PIN de 4 dígitos es lo que el tendero
  usará; la protección real son el bloqueo (§5.2) y el pepper (§7). Subir el mínimo a 6 mejora poco frente a un bloqueo bien puesto
  y empeora mucho el uso.
- Se rechazan al **crear o cambiar** un PIN: todos iguales (`0000`, `7777`), secuencias ascendentes o descendentes
  (`1234`, `4321`, `2580`), patrones repetidos (`1212`, `123123`), una lista corta de PIN comunes (`1004`, `2000`, `6969`…),
  el PIN igual a los últimos 4–6 dígitos del celular del usuario, y años 1950–2030 si el PIN tiene 4 dígitos. La lista y las reglas
  viven en una función pura `validatePin(pin, { phone? })` con tests.
- Los PIN existentes no se tocan; la regla aplica al próximo cambio. (Si un OWNER actual tiene `1234`, se le avisa en Ajustes.)

### 5.2 Límite de intentos (Postgres, sin Redis)
Objetivo de **D7**: frenar la adivinanza **sin** que un tercero pueda dejar fuera al dueño. Para eso el bloqueo se cuenta por **cuenta + IP**
y no solo por cuenta. Una sola tabla `RateLimit`, una sentencia atómica por intento (`INSERT ... ON CONFLICT (key) DO UPDATE ... RETURNING`).

`h(cuenta)` = HMAC del identificador normalizado (`phone:<celular>` o `emp:<código>:<usuario>`); `h(ip)` = HMAC de la IP de §5.3.

| Clave de conteo | Qué cuenta | Umbral | Efecto |
|---|---|---|---|
| `acctip:<h(cuenta)>:<h(ip)>` | fallos contra ESA cuenta desde ESA IP | 5 en 15 min | bloquea ese par (cuenta, IP) |
| `acct:<h(cuenta)>` | fallos contra la cuenta desde CUALQUIER IP | 25 en 1 h | bloquea el CONTADOR DE CUENTA (D15: no cuenta lo que llenan otras IPs si esta IP es conocida) |
| `ip:<h(ip)>:login` | fallos desde esa IP contra cualquier cuenta | 30 en 10 min | bloquea esa IP para login |
| `ip:<h(ip)>:register` | registros desde esa IP | 5 por hora | bloquea esa IP para registrar |

**Progresión (D7).** El **primer bloqueo es de 5 minutos.** Solo escala si los ciclos **se repiten**: `strikes` sube únicamente cuando, tras
desbloquearse, se vuelve a alcanzar el umbral dentro de 24 h: 5 min → 15 min → 60 min (**máximo 1 hora**). Sin fallos durante 24 h,
`strikes` vuelve a 0. Un login correcto borra la fila `acctip` de ese par y reduce el conteo `acct`.

**Por qué un tercero no deja fuera al dueño.**
- Quien teclea mal desde su propia IP solo bloquea el par (cuenta, su IP); el dueño, desde la suya, tiene su propio contador en cero.
- Para bloquear la cuenta completa hacen falta ≥ 25 fallos repartidos entre varias IPs (infraestructura de ataque), el bloqueo dura 5 minutos
  (máximo 1 hora si el ataque persiste) y el contador de cuenta **no le cierra la puerta al dueño desde una IP desde la que ya entró antes** (D15; no es un acceso extra: su límite por (cuenta, IP) sigue aplicando siempre).
- Las sesiones abiertas no se tocan: el bloqueo es solo del login.
- Límite honesto: un ataque distribuido y sostenido aún puede incomodar al dueño desde una IP nueva hasta 1 hora. No se elimina del todo
  sin dispositivos de confianza (deuda, §10).

Resto de reglas:
- La respuesta de bloqueo es **idéntica** exista o no la cuenta (se cuenta también para cuentas inexistentes), para no revelar existencia.
- Límite por IP **generoso**: en Colombia muchos celulares comparten IP (CGNAT). El control principal es el de cuenta + IP.
- Costo en Neon: una escritura por intento de login (~una vez al mes por dispositivo), cero para el tráfico normal. Limpieza de `RateLimit` a las **24–48 h** (borrado oportunista de
  filas con más de 48 h sin actividad; un job o el propio login las purga). Es un freno suficiente para este uso, no un limitador de alto volumen.
- `bcrypt.compare` bloquea el event loop con `bcryptjs`: el límite por IP evita que se use como amplificador de carga.
- El OWNER puede desbloquear a un empleado (borra sus filas `acctip` y `acct`).

**D15 · APROBADA con precisiones: "IP conocida".** Una IP es *conocida* para una cuenta si su HMAC tuvo un `LOGIN_OK` de esa cuenta en los últimos 30 días
(`AuthEvent`). Reglas:
- El límite por **(cuenta, IP) aplica SIEMPRE**, también desde una IP conocida.
- La IP conocida solo evita que cuente, contra ese dueño, el **contador de cuenta** (`acct:`) que llenan **otras** IPs. **Nunca otorga acceso adicional**:
  no salta el PIN, ni el bloqueo del par, ni el de IP.
- Es una **señal débil**: en Colombia las IPs móviles son compartidas (CGNAT) y cambian; una IP "conocida" puede pertenecer a otra persona del mismo operador.
  Por eso solo sirve para no castigar de más al dueño, nunca para dar confianza.

### 5.3 IP del cliente: un solo helper, `getClientIp()` (D7)
Archivo `lib/client-ip.ts`. **Regla: la IP se lee de UN header, el que el despliegue declare de confianza en la variable `CLIENT_IP_HEADER`.
Nunca se confía ciegamente en `x-forwarded-for`**: el cliente puede enviarlo con valores falsos para esquivar los límites.

| Despliegue | `CLIENT_IP_HEADER` | Condición para confiar |
|---|---|---|
| VPS + Nginx (el plan actual) | `x-real-ip` | Nginx lo **sobrescribe** (`proxy_set_header X-Real-IP $remote_addr;`, sin pasar el del cliente) y Node escucha solo en `127.0.0.1` (el puerto de la app no queda expuesto) |
| Cloudflare delante de Nginx | `cf-connecting-ip` | El Nginx acepta solo conexiones desde los rangos de Cloudflare |
| Otra plataforma administrada | el header que documente la plataforma | Se revisa caso por caso antes de usarla |
| Desarrollo / pruebas | (vacío) | Se usa `127.0.0.1`; los tests inyectan la IP |

Detalles: si el header trae una lista separada por comas se toma la **última** entrada (la que añadió nuestro proxy), nunca la primera; el valor
se valida con `net.isIP` y, si no es válido o falta, se devuelve `"unknown"`. **Recomendación:** en producción la app **no arranca** sin
`CLIENT_IP_HEADER`, igual que con el pepper (evita desplegar sin límite por IP real). Se guarda solo el HMAC de la IP (D13, aprobada), calculado con una clave propia **`IP_HASH_KEY`** (≥ 32 bytes aleatorios), **distinta del pepper del PIN y de `JWT_SECRET`**; placeholder en `.env.example`, nunca commiteada, y en producción la app no arranca si falta. Rotarla rompe la correlación histórica de IPs (no las sesiones).

---

## 6. Auditoría y sincronización

### 6.1 Eventos (`AuthEvent`)
`LOGIN_OK`, `LOGIN_FAIL`, `LOGIN_LOCKED`, `LOGOUT`, `PIN_CHANGED`, `PIN_RESET_BY_OWNER`, `SESSIONS_REVOKED`,
`EMPLOYEE_CREATED`, `EMPLOYEE_DEACTIVATED`, `EMPLOYEE_REACTIVATED`, `STORE_REGISTERED`.

### 6.2 Qué NO se guarda
Nunca PIN (ni en claro ni hash), tokens, ni cookies. En fallos no se guarda el celular o usuario escrito: solo un **hash HMAC** del
identificador (sirve para correlacionar intentos). El `meta` solo lleva datos no sensibles (p. ej. el `userId` afectado).
La IP se guarda como hash HMAC (no en claro) y el `userAgent` recortado. Es la postura más prudente frente a la Ley 1581
(datos personales); si quieres la IP en claro para investigar incidentes, se mantiene el HMAC con `IP_HASH_KEY` (D13, aprobada).

### 6.3 Retención y visibilidad
Retención: **`AuthEvent` 180 días** (borrado oportunista); **`RateLimit` se limpia a las 24–48 h** (D14, aprobada). El OWNER ve "último acceso" por empleado y los últimos eventos de su tienda (sin hashes).

### 6.4 Interacción con el modo offline (D10: principio aceptado, **NO se implementa ahora**)
Se implementa junto con la fase offline (paso 5). Queda documentado aquí para no decidir a ciegas entonces.

- **Principio.** El servidor decide el autor: en `/api/sync` el `createdByUserId` no se toma del payload como verdad. Cada mutación lleva
  `authorUserId` y el servidor la acepta solo si ese usuario pertenece a la tienda de la sesión y la sesión es de ese mismo usuario **o del
  OWNER**. Un EMPLOYEE no sube mutaciones de otro.
- **Riesgo: el reloj del dispositivo no es confiable.** La fecha de una mutación (`createdAtClient`) la pone el dispositivo. Un empleado dado
  de baja podría adelantar o atrasar el reloj para que sus movimientos parezcan anteriores a `deactivatedAt`. Por eso la fecha del cliente
  **nunca será un control de seguridad**, solo un dato informativo. El servidor guarda siempre `receivedAt` con su propio reloj.
- **Propuesta: marcar "sincronizado tarde" (`syncedLate`), visible para el dueño.** Se marca todo movimiento que (a) llegue de un autor ya
  desactivado o (b) tenga una diferencia grande entre `createdAtClient` y `receivedAt` (umbral por definir, p. ej. 24 h). No se pierden ni se
  rechazan en silencio: se guardan atribuidos a su autor, con la marca, y el OWNER puede revisarlos y anularlos (append-only). Los de un autor
  desactivado quedarían además "pendientes de confirmar" por el OWNER.
- Un 401 durante el sync **no vacía la cola**: la app pide volver a entrar y reintenta.
- **Pendiente para entonces:** umbral de "tarde", si la confirmación aplica a todo lo de un autor desactivado, y la pantalla del OWNER.

---

## 7. Migración de datos existentes (no destructiva y reversible)

Patrón expandir → rellenar → restringir, en **una** migración revisable. El SQL se genera con `prisma migrate diff`, **se lee y se edita a mano**
(en particular el renombre, D8) y se escribe un `down.sql`, probado en la BD de pruebas (Prisma no tiene "down": vive en la carpeta de la
migración y no se ejecuta solo). Nunca `db push`, `migrate dev` ni `migrate reset`.

Orden:
1. **Conteos "antes" en dev** (solo lectura): filas por tabla; `Sale` y `Payment` con `userId` no nulo; usuarios por rol; tiendas sin OWNER o con varios. Se guardan para comparar.
2. `ALTER TABLE "User"`: `phone DROP NOT NULL`; agregar `username`, `tokenVersion DEFAULT 0`, `mustChangePin DEFAULT false`,
   `pinHashVersion DEFAULT 1`, `deactivatedAt`, `pinChangedAt`, `lastLoginAt`.
3. **Verificación previa que detiene la migración** si falla (no elige por su cuenta): todo usuario tiene rol; cada tienda tiene exactamente un OWNER activo.
4. `Store.code`: columna nullable → relleno (bloque `DO $$`, mismo alfabeto, reintento ante choque) → `NOT NULL` + `UNIQUE`.
5. Crear `RateLimit` y `AuthEvent`.
6. **`RENAME COLUMN` a mano** de `Sale.userId` y `Payment.userId` a `createdByUserId`, con renombre de la FK compuesta y de los índices que la incluyan
   (§2.4, D8). Agregar `voidedByUserId` y su FK compuesta en `Sale`, `Payment` y `StockEntry`.
7. CHECK: rol/phone/username; índice único parcial de OWNER; `createdByUserId IS NOT NULL` **`NOT VALID`**; simetría `voidedAt`/`voidedByUserId`.
8. **Conteos "después" en dev** y comparación con los de "antes": mismas filas por tabla, mismos autores no nulos que los `userId` de antes, y
   `prisma migrate diff` del schema contra la BD **vacío**.

`down.sql` deshace en orden inverso (incluido el `RENAME COLUMN` de vuelta). Límites honestos: devolver `phone` a `NOT NULL` solo funciona
**mientras no existan empleados sin celular**, y los datos escritos en columnas nuevas (usuarios, autoría de movimientos posteriores) se pierden
al volver atrás. Ningún dato original se modifica ni se borra.

Se aplica primero a la BD de **pruebas**; a dev solo con tu aprobación, con el mismo procedimiento que R1 (URL directa sin `-pooler`,
`migrate deploy`, verificación en `pg_constraint`).

---

## 8. Pruebas (lista concreta)

**Integración (BD de pruebas)**
- Aislamiento: el mismo `username` en dos tiendas es válido; repetido en la misma, `P2002`; el código de tienda es único; un EMPLOYEE de la tienda A no
  puede leer ni escribir datos de B a través de `route()`/`storeDb`.
- Un solo OWNER por tienda (el segundo se rechaza); OWNER sin celular y EMPLOYEE sin usuario se rechazan por CHECK.
- Autoría: crear venta/abono guarda el `createdByUserId` de la sesión; un `createdByUserId` en el `data` se rechaza; anular guarda `voidedByUserId`;
  `voidedAt` sin `voidedByUserId` se rechaza; un autor de otra tienda se rechaza por FK.
- Migración: sobre una copia con usuarios y ventas sembrados con el schema viejo, tras migrar todos quedan OWNER, **los conteos antes y después
  coinciden**, las ventas viejas conservan su autor (o NULL) y `down.sql` devuelve el esquema anterior. `migrate diff` posterior queda vacío.
- Revocación: desactivar a un empleado hace que su siguiente request dé 401; cada evento que sube `tokenVersion` (D1) invalida el token anterior;
  el logout normal **no** lo invalida; tienda con `isActive=false` también da 401.
- Bloqueo (D7): 5 fallos desde la IP X contra la cuenta C → 6.º intento bloqueado desde X aunque el PIN sea correcto, **y el dueño desde la IP Y sigue
  entrando** (un tercero no lo deja fuera); ≥ 25 fallos repartidos en varias IPs bloquean la cuenta 5 min, salvo desde una IP conocida (D15);
  el primer bloqueo es de 5 min y solo escala a 15 y 60 si el ciclo se repite en 24 h (tope 1 h); tras 24 h sin fallos vuelve a 5 min; una cuenta
  inexistente se bloquea igual y con el mismo mensaje; un login correcto limpia el par; el límite por IP.
- Carrera de registro: dos `register` simultáneos con el mismo celular → uno 201 y otro **409** (no 500).

**Unitarias**
- `validatePin` (triviales, secuencias, patrones, igual al celular, años); normalización y alfabeto del código de tienda; `can()` contra la matriz completa.
- `getClientIp`: lee solo el header configurado; ignora `x-forwarded-for` si no es el configurado; con lista toma la última entrada; valor inválido → `"unknown"`;
  producción sin `CLIENT_IP_HEADER` → error al arrancar.
- Pepper (D9): el hash v2 verifica con su pepper y no con otro; un hash v1 existente verifica y se re-hashea a la versión vigente; el hash guardado no
  contiene el PIN ni coincide con `bcrypt(pin)` sin pepper; en producción, sin pepper o con uno corto → no arranca.
- Login con celular inexistente: se llama a `bcrypt.compare` (simulado) igual que con uno existente (el test comprueba la llamada, no mide milisegundos).

**De rutas / contrato**
- Middleware (paso 2): `/login`, `/registro`, `/api/auth/login`, `/api/auth/register` son públicas por **coincidencia exacta**; `/login-x`, `/registro-x`,
  `/api/auth/login-x` **no** lo son.
- Origen: `POST/PUT/PATCH/DELETE` a `/api` con `Origin` ajeno → 403; los `GET` no se revisan.
- EMPLOYEE recibe 403 en cada acción prohibida (anular, precios, archivar cliente, estadísticas de ganancia, empleados, ajustes) y 200 en las permitidas
  (con sesiones sintéticas, mientras no existan las pantallas de empleados). OWNER recibe 200.
- Sin cookie → 401; firma mala o `tv` viejo → 401; `mustChangePin` bloquea todo salvo `pin.change`.
- El test de cobertura de §4.4 (todas las rutas envueltas).
- Cookie: `httpOnly`, `sameSite=lax`, `secure` en producción, prefijo `__Host-`.

---

## 9. Pasos de implementación (cada uno verificable)

**Orden y alcance.** Los pasos **1 a 3 van ANTES del Sprint 1** (fiados): así las rutas de fiados nacen ya con `route()`, con autoría y con el login seguro.
El **paso 4 (pantallas y flujos de empleados) va DESPUÉS del Sprint 1.** El **paso 5 (contrato de sync offline) va con la fase offline.**

`Paso 1 → Paso 2 → Paso 3 → [Sprint 1: fiados] → Paso 4 → [fase offline] → Paso 5`

| # | Paso | Qué incluye | Criterio de aceptación |
|---|---|---|---|
| **1** | **Schema + autoría** (antes del Sprint 1) | Todo el schema de §2 (columnas de `User`, `Store.code`, `RateLimit`, `AuthEvent`, `pinHashVersion`); `RENAME COLUMN` **a mano** `userId → createdByUserId` + FK e índices; `voidedByUserId`; CHECK (`createdByUserId` `NOT VALID`); `down.sql`; tests de BD | SQL generado con `migrate diff`, leído y editado; en pruebas: `migrate deploy` limpio, `down.sql` probado, `migrate diff` posterior vacío; **conteos antes/después en dev idénticos** (con tu aprobación para tocar dev); tests de BD de §8 pasan |
| **2** | **Núcleo de sesión y `route()`** (antes del Sprint 1) | Token mínimo con `tv`; `getSession()` con lectura a BD; cookie endurecida; **middleware con rutas públicas por coincidencia EXACTA (no `startsWith`) y validación de `Origin` en los métodos que modifican**; `lib/authz.ts` (matriz) y `route()`/`publicRoute()`; regla ESLint + test de cobertura; `storeDb({storeId, userId})` con autoría y `void`; las consultas de `app/api/auth` pasan a `lib/` (se retira la excepción de ESLint) | Tests de middleware (`/login-x` no público; `Origin` ajeno → 403), de revocación, 401/403 y de cobertura pasan; ESLint falla si una ruta no se envuelve; latencia medida de `getSession()` reportada |
| **3** | **Registro y login OWNER seguros, con pepper** (antes del Sprint 1) | `validatePin`; `RateLimit` con claves cuenta+IP/cuenta/IP; `getClientIp()` (§5.3); **hash del PIN = HMAC-SHA256(pepper) + bcrypt, con `pinHashVersion`** (§2.6), variables de pepper distintas de `JWT_SECRET`, placeholders en `.env.example` y arranque que falla en producción si faltan; **`P2002` en la carrera de registro → 409**; **`bcrypt.compare` simulado cuando el celular no existe**; `AuthEvent`; código de tienda generado en el registro; cambio de PIN propio y "cerrar todas" (suben `tokenVersion`); logout | Tests de §8 (bloqueo, pepper, IP, PIN, carrera 409, compare simulado) pasan; el OWNER existente entra con su PIN actual (hash v1 → se actualiza al entrar); `typecheck`, `lint`, `test`, `test:integration` y `build` verdes |
| — | **Sprint 1: fiados** | Usa `route()`, `storeDb({storeId,userId})` y `createdByUserId` desde el primer día | (lo define el Prompt 4) |
| **4** | **Empleados** (después del Sprint 1) | Alta, baja, reactivación, reseteo de PIN y desbloqueo; login de empleado (código + usuario + PIN); `mustChangePin`; pantallas (login con código, Ajustes › Empleados) | Un empleado entra, registra una venta con su autoría, no puede anular (403); al desactivarlo, su siguiente request da 401 |
| **5** | **Contrato de sync offline** (con la fase offline) | Regla de autoría de §6.4 (D10): `authorUserId`, `receivedAt`, "sincronizado tarde" visible al dueño, reloj no confiable | Tests de la regla de sync; una mutación de un autor desactivado queda marcada y no se pierde |

Cada paso cierra con `typecheck`, `lint`, `test`, `test:integration` y `build` verdes, y se entrega con su reporte antes de empezar el siguiente.

### Estado del paso 1 (implementado)

Migración `20261111120000_r2_auth_schema_autoria` (con `down.sql`), probada up → down → up en la BD de pruebas y aplicada a dev.
Lo implementado coincide con §2 y §7, con estas **desviaciones y decisiones tomadas al implementar**:

1. **`void_pair` también va `NOT VALID`** (§7 solo lo decía de la autoría). Con el CHECK validado, una anulación histórica sin
   "quién anuló" lo violaría. Igual que la autoría: exige el par a filas nuevas o modificadas; el histórico no se revalida.
2. **Límite conocido de `NOT VALID`:** Postgres también evalúa el CHECK al **modificar** una fila histórica. Si existiera una venta
   anterior a R2 sin autor, anularla (UPDATE) fallaría por `created_by_required_chk`. Hoy no hay ninguna (dev tiene 0 ventas y 0 abonos).
   Si aparece el caso, la alternativa es una condición por fecha de corte (`"createdByUserId" IS NOT NULL OR "createdAt" < <corte>`).
3. **CHECK adicionales:** formato de `username` (`^[a-z0-9._]{3,20}$`), `Store.code` (`^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$`),
   `tokenVersion >= 0` y `pinHashVersion >= 1`.
4. **Código existente que hubo que tocar:** `Store.code` es obligatorio, así que `register` genera el código (`lib/store-code.ts`) y reintenta
   si choca; y `storeDb.<sale|payment|stockEntry>.void(id, voidedByUserId)` ahora recibe quién anula (si no, violaría el CHECK de pareja).
   La carrera de registro por celular repetido (409) sigue pendiente para el paso 3.
5. **`down.sql` se niega** si existen usuarios sin celular (empleados); no cambia nada y avisa.

---

## 10. Riesgos y deuda (qué queda fuera y por qué)

- **Pérdida del pepper (D9):** con pepper nadie puede iniciar sesión si se pierde. Mitigación: gestor de contraseñas + variables del VPS + procedimiento de
  rotación con versiones (§2.6).
- **Recuperación de PIN del OWNER:** no existe en el MVP. Si el dueño olvida su PIN solo se puede resetear a mano (lo que hicimos con el script de
  desarrollo), con verificación de identidad fuera de la app. Después: OTP por WhatsApp/SMS (costo por mensaje y proveedor), con su propio diseño.
- **2FA, dispositivos de confianza y cierre de sesión por dispositivo:** no entran. La opción B de revocación permite migrar a eso después.
- **Bloqueo y ataques distribuidos:** el bloqueo por cuenta + IP evita el caso simple (un tercero tecleando mal), pero un ataque sostenido desde muchas IPs
  aún puede incomodar al dueño hasta 1 h desde una IP nueva. Dispositivos de confianza lo resolverían.
- **IP del cliente:** `getClientIp()` es seguro solo si Nginx sobrescribe el header y Node no queda expuesto. Va en la lista de verificación del deploy.
- **Enumeración de celulares en el registro** (409 "ya está registrado"): se mitiga con el límite por IP, no se elimina; es el compromiso de usabilidad.
- **Rotación de `JWT_SECRET`:** cambiarlo cierra todas las sesiones; no hay rotación gradual (`kid`). Aceptable ahora.
- **Anulación solo del OWNER:** si el empleado se equivoca debe llamar al dueño; es decisión de producto y hay que vigilar la fricción.
- **Índice parcial de OWNER y Prisma:** posible choque con el detector de drift (§2.1); se verifica en el paso 1.
- **Lectura a BD en cada request autenticada:** la latencia en Neon free no está medida; se mide en el paso 2.
- **Reloj del dispositivo (D10):** no es confiable; se gestiona en la fase offline con "sincronizado tarde" (§6.4).
- **Pantallas de empleados después del Sprint 1:** hasta el paso 4 solo hay OWNER; las acciones de empleado ya están protegidas por `route()` y se
  prueban con sesiones sintéticas, pero no hay prueba de punta a punta con un empleado real hasta entonces.
- **Sesiones actuales (D11, decidido):** todos vuelven a entrar una vez al activar el paso 2.
- **zod (D12, decidido):** la migración 3→4 es una tarea separada, antes del deploy (ver `docs/DEUDA_SEGURIDAD.md`), para no mezclar riesgos.

---

## 11. Decisiones (18 entradas: las 16 de la primera versión + D15 y D16 nuevas)

Estado: ✅ = decidida/aprobada por ti (con las precisiones que pediste). **No queda ninguna decisión pendiente.**

| # | Tema | Estado | Decisión / recomendación |
|---|---|:-:|---|
| D1 | Revocación de sesiones | ✅ | Opción A, `tokenVersion`; sube al desactivar, **cambiar o resetear PIN**, reactivar y en **"cerrar todas"** |
| D1b | Semántica del logout | ✅ | El logout normal solo borra la cookie |
| D2 | Duración del token | ✅ | 30 días deslizantes, tope 90 desde el último login |
| D3 | Largo del código de tienda | ✅ | 6 caracteres, alfabeto sin ambiguos |
| D4 | Celular de empleados | ✅ | Opcional y único global (limitación aceptada) |
| D5 | Permisos marcados con `?` | ✅ | Empleado crea clientes; no edita ni archiva; no inventario; "Hoy" propio sin ganancia; cierre de caja solo OWNER |
| D6 | PIN de empleado | ✅ | Temporal generado + cambio obligatorio |
| D7 | Bloqueo por intentos | ✅ | 4–6 dígitos con lista de triviales; primer bloqueo 5 min, progresivo solo si los ciclos se repiten, máx. 1 h; conteo por cuenta+IP y por cuenta; IP desde `getClientIp()` |
| D7b | Umbrales numéricos | ✅ | **Aprobada:** 5 fallos/15 min por (cuenta, IP); 25/h por cuenta; 30/10 min por IP; 5 registros/h por IP. Se ajustan con datos reales |
| D8 | `userId → createdByUserId` | ✅ | `RENAME COLUMN` a mano (+ FK e índices), conteos antes/después en dev, CHECK `NOT VALID` |
| D9 | Pepper del PIN | ✅ | HMAC-SHA256 + bcrypt, `pinHashVersion`, variable distinta del JWT, en el **paso 3**; sin pepper no arranca en producción |
| D10 | Autoría offline | ✅ | Principio aceptado, **no se implementa ahora**; riesgo del reloj documentado; "sincronizado tarde" visible al dueño |
| D11 | Sesiones existentes | ✅ | Forzar un re-login |
| D12 | Migración de zod | ✅ | Tarea separada |
| D13 | IP en `AuthEvent` / `RateLimit` | ✅ | **Aprobada:** solo el HMAC de la IP, con clave propia `IP_HASH_KEY` (distinta del pepper y del JWT; placeholder en `.env.example`) |
| D14 | Retención | ✅ | **Aprobada:** `AuthEvent` 180 días; `RateLimit` se limpia a las 24–48 h |
| D15 | IP conocida y bloqueo de cuenta | ✅ | **Aprobada con precisión:** el límite por (cuenta, IP) aplica SIEMPRE; la IP conocida solo evita el contador de cuenta que llenan otras IPs y nunca da acceso adicional. Señal débil (IPs móviles compartidas) |
| D16 | Hashes v1 (sin pepper) | ✅ | **Aprobada:** sin fecha de corte; se actualizan solos en el siguiente login. Se revisa antes del deploy |

D15 y D16 salieron de tus ajustes a D7 y D9; D7b, D13, D14, D15 y D16 se aprobaron en la ronda de cierre.

