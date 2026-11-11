# R2 — Autenticación, roles y sesiones (documento de DISEÑO)

Estado: **borrador para aprobación. No hay código ni migraciones escritas.**
Rama: `feat/r2-autenticacion-diseno` (creada desde el árbol de R1; R1 sigue sin commitear, ver §10).
Convención: cada punto que necesita decisión tuya está marcado **[DECIDIR]** con mi recomendación.

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
| `lastLoginAt` | `DateTime?` | El OWNER ve "último acceso" de cada empleado. |

CHECK (SQL manual en la migración, como en R1):
- `role = 'OWNER'` ⇒ `phone IS NOT NULL`.
- `role = 'EMPLOYEE'` ⇒ `username IS NOT NULL`.
- Índice único parcial: `CREATE UNIQUE INDEX ... ON "User"("storeId") WHERE "role" = 'OWNER'` ⇒ exactamente un OWNER por tienda
  (el "obligatorio" lo garantiza el registro, que crea tienda y OWNER en una transacción).

> Riesgo técnico a verificar en el paso 1: Prisma no modela índices parciales; hay que comprobar con
> `migrate diff` y `migrate status` que no intente borrarlo. Si lo intenta, se documenta y se deja el índice fuera
> del schema con un test de integración que verifique que existe.

**[DECIDIR 4] Celular de empleados.** `phone` queda único **global**. Consecuencia: una persona no puede ser dueña de la
tienda A y empleada de la B con el mismo celular. *Recomiendo* aceptarlo en el MVP (cero SQL no modelable, y el
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

**[DECIDIR 3]** *Recomiendo* 6 caracteres. Con 5 (24 millones) también alcanza para años de tiendas, y es más corto de dictar;
subir a 6 cuesta poco y deja margen contra enumeración. Dime si prefieres 5.

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

**[DECIDIR 1]** Confirmar A. Subdecisión: *logout* = solo borrar cookie (recomendado) vs. subir `tokenVersion` en cada logout
(cierra al dueño en todos sus dispositivos cada vez: mala experiencia).

### 2.4 Autoría y anulación
- `Sale.userId` y `Payment.userId` pasan a llamarse **`createdByUserId`** con `ALTER TABLE ... RENAME COLUMN` y
  `RENAME CONSTRAINT` de la FK compuesta (solo metadatos, reversible, sin duplicar columnas).
- Obligatorio hacia adelante, **sin inventar historia**: los registros anteriores con NULL se dejan en NULL ("autor
  desconocido, anterior a R2") y se agrega `CHECK ("createdByUserId" IS NOT NULL) NOT VALID`: Postgres lo exige a toda fila
  nueva o modificada y no revisa las existentes. `VALIDATE` queda para cuando no haya NULL.
- `voidedByUserId` (nullable) en `Sale`, `Payment` y `StockEntry`, con FK compuesta `(voidedByUserId, storeId)` igual que
  R1 (Restrict) y `CHECK ((voidedAt IS NULL) = (voidedByUserId IS NULL))`.
- `storeDb` cambia a `storeDb({ storeId, userId })`: el `create` de venta/abono **inyecta** `createdByUserId`
  (igual que `storeId`; `assertScalarData` rechaza que venga en `data`) y `void(id)` fija `voidedAt` y `voidedByUserId`.
  El cliente nunca decide quién es el autor.

**[DECIDIR 8]** *Recomiendo* renombrar (arriba) en lugar de agregar una columna nueva y dejar `userId` deprecado. Ahorra una
columna muerta y una migración de limpieza; el renombre es metadatos y es reversible.

### 2.5 Tablas nuevas
```
RateLimit  { key String @id, fails Int, strikes Int, windowStart DateTime, lockedUntil DateTime?, updatedAt DateTime }
AuthEvent  { id, createdAt, type AuthEventType, storeId String?, userId String?, ok Boolean,
             ipHash String?, userAgent String? (recortado a 120), meta Json? }
```
Sin FK en `AuthEvent.userId`/`storeId` hacia el aislamiento estricto: se guardan como referencia lógica (un evento de login
fallido no tiene usuario). Append-only: la app solo hace `INSERT`.

---

## 3. Flujos

**3.1 Registro de tienda (OWNER)** — `POST /api/auth/register`
1. Límite por IP (§5). 2. Validar (zod), `normalizePhone`, política de PIN (§5.1). 3. `bcrypt.hash` **fuera** de la transacción.
4. Transacción: crear `Store` (con código, reintento ante `P2002`) + `User` OWNER. `P2002` en `phone` ⇒ 409 (hoy es un 500
por carrera). 5. `AuthEvent STORE_REGISTERED`. 6. Firmar token con `tv=0`, poner cookie.
7. La pantalla de éxito muestra el código de la tienda ("Este es el código para tus empleados"); queda visible en Ajustes.

**3.2 Login OWNER** — celular + PIN
1. Revisar bloqueo por IP y por cuenta (clave `acct:phone:<hash>`). Si está bloqueada ⇒ 429 genérico (se bloquea
igual exista o no la cuenta, para no revelar existencia). 2. Buscar `User` por `phone`. 3. **Siempre** ejecutar `bcrypt.compare`
(contra un hash falso si no existe) para igualar tiempos. 4. Si falla, o si `isActive` / `Store.isActive` es falso ⇒
mismo mensaje "Celular o PIN incorrecto", cuenta el intento. 5. Si pasa: limpiar contador, `lastLoginAt`, `AuthEvent LOGIN_OK`,
token con el `tokenVersion` actual, cookie.

**3.3 Login EMPLOYEE** — código de tienda + usuario + PIN
Igual que 3.2 con clave de cuenta `acct:emp:<código>:<usuario>`; se busca la tienda por código y el usuario por
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
**[DECIDIR 6]** *Recomiendo* PIN temporal generado + cambio obligatorio: el dueño nunca conoce el PIN definitivo del empleado,
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
- **Duración [DECIDIR 2]**: *recomiendo* 30 días con renovación deslizante (se reemite cuando el token tiene más de 7 días
  de antigüedad; lo hace el middleware, que sí puede escribir cookies) y tope absoluto de 90 días desde el último login
  (claim `auth_at`). Con la revocación en BD ya no hay que usar 90 días fijos "por si acaso".
- Cookie: `httpOnly`, `secure` en producción, `path=/`. En producción el nombre es `__Host-fiao_session` (obliga `Secure`,
  `Path=/` y sin `Domain`); en desarrollo `fiao_session` (por `http://localhost`).
- **`sameSite=lax` se mantiene** (no `strict`): los enlaces que abren la app desde WhatsApp son navegaciones externas y con
  `strict` llegarían sin sesión. La defensa CSRF es `lax` + verificación del `Origin`/`Host` en todo `POST/PUT/PATCH/DELETE`
  de `/api` (en el middleware).
- Al arrancar: `JWT_SECRET` debe tener al menos 32 bytes, si no, falla fuerte.
- Con el cambio, los tokens actuales (sin `tv`) quedan inválidos: todos vuelven a entrar una vez. **[DECIDIR 11]** *Recomiendo*
  aceptarlo (hoy hay 2 usuarios en dev, y evita confiar en `role` del token viejo).

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

**[DECIDIR 5]** Los puntos con `?`. *Recomiendo*: el empleado **crea** clientes (sin eso no puede fiar a alguien nuevo) pero no los
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
- Largo **4 a 6 dígitos** (se mantiene). **[DECIDIR 7]**: *recomiendo mantener 4–6*: un PIN de 4 dígitos es lo que el tendero
  usará; la protección real son el bloqueo (§5.2) y el pepper (§7). Subir el mínimo a 6 mejora poco frente a un bloqueo bien puesto
  y empeora mucho el uso.
- Se rechazan al **crear o cambiar** un PIN: todos iguales (`0000`, `7777`), secuencias ascendentes o descendentes
  (`1234`, `4321`, `2580`), patrones repetidos (`1212`, `123123`), una lista corta de PIN comunes (`1004`, `2000`, `6969`…),
  el PIN igual a los últimos 4–6 dígitos del celular del usuario, y años 1950–2030 si el PIN tiene 4 dígitos. La lista y las reglas
  viven en una función pura `validatePin(pin, { phone? })` con tests.
- Los PIN existentes no se tocan; la regla aplica al próximo cambio. (Si un OWNER actual tiene `1234`, se le avisa en Ajustes.)

### 5.2 Límite de intentos, en Postgres, sin Redis
Una sola tabla `RateLimit` con una sentencia atómica por intento (`INSERT ... ON CONFLICT (key) DO UPDATE ... RETURNING`):

| Clave | Umbral propuesto | Efecto |
|---|---|---|
| `acct:phone:<hash>` / `acct:emp:<código>:<usuario>` | 5 fallos en 15 min | Bloqueo 5 min; cada reincidencia duplica: 5 → 10 → 20 → 40 → 60 min (tope 1 h) |
| `ip:<ip>:login` | 30 fallos en 10 min | Bloqueo 10 min |
| `ip:<ip>:register` | 5 registros por hora | Bloqueo 1 h |

- El contador de cuenta se aplica **igual a cuentas que no existen** (clave por hash del identificador): la respuesta de bloqueo
  no revela si la cuenta existe. Éxito ⇒ se borra la fila de esa cuenta.
- **Bloqueo temporal progresivo y no definitivo**, a propósito: con un bloqueo permanente alguien podría dejar fuera al dueño
  tecleando mal su celular. El OWNER puede desbloquear a un empleado.
- **Límite por IP generoso**: en Colombia muchos celulares comparten IP (CGNAT de operadores). El control principal es el de cuenta;
  el de IP solo frena escaneos masivos. La IP se toma de `X-Forwarded-For` **solo si** viene del Nginx propio (a definir en el
  deploy; hasta entonces, la conexión directa).
- **Costo en Neon**: una escritura por intento de login (el login ocurre ~una vez al mes por dispositivo), cero para el
  tráfico normal. Limpieza: borrado de filas de más de 1 día de forma oportunista. Una tabla en Postgres no es un límite de
  velocidad de alto volumen; para este uso sobra.
- `bcrypt.compare` es costoso (bloquea el event loop con `bcryptjs`): el límite por IP también evita que se use como
  amplificador de carga.
**[DECIDIR 7b]** Los umbrales de la tabla son punto de partida. *Recomiendo* aprobarlos y ajustar con datos reales.

---

## 6. Auditoría y sincronización

### 6.1 Eventos (`AuthEvent`)
`LOGIN_OK`, `LOGIN_FAIL`, `LOGIN_LOCKED`, `LOGOUT`, `PIN_CHANGED`, `PIN_RESET_BY_OWNER`, `SESSIONS_REVOKED`,
`EMPLOYEE_CREATED`, `EMPLOYEE_DEACTIVATED`, `EMPLOYEE_REACTIVATED`, `STORE_REGISTERED`.

### 6.2 Qué NO se guarda
Nunca PIN (ni en claro ni hash), tokens, ni cookies. En fallos no se guarda el celular o usuario escrito: solo un **hash HMAC** del
identificador (sirve para correlacionar intentos). El `meta` solo lleva datos no sensibles (p. ej. el `userId` afectado).
La IP se guarda como hash HMAC (no en claro) y el `userAgent` recortado. Es la postura más prudente frente a la Ley 1581
(datos personales); si quieres la IP en claro para investigar incidentes, es [DECIDIR] menor.

### 6.3 Retención y visibilidad
Retención 180 días (borrado oportunista). El OWNER ve "último acceso" por empleado y los últimos eventos de su tienda (sin hashes).

### 6.4 Interacción con el modo offline (importante para el Sprint de sync)
- El servidor decide el autor: en `/api/sync` el `createdByUserId` **no se lee del payload como verdad**; se valida contra la sesión.
- Caso real: un celular compartido donde el empleado A registra offline y luego entra B. **[DECIDIR 10]** *Recomiendo*: cada
  mutación de la cola guarda `authorUserId`; el servidor la acepta si `authorUserId` pertenece a la tienda de la sesión y la
  sesión es de ese mismo usuario **o del OWNER**; un EMPLOYEE no puede subir mutaciones de otro.
- Un empleado dado de baja con mutaciones pendientes: se aceptan las creadas **antes** de `deactivatedAt` (por eso la columna) y
  se rechazan las posteriores, que quedan marcadas "rechazada" en la cola para que el OWNER las vea. Nunca se pierden en silencio.
- Un 401 del servidor durante el sync **no vacía la cola**: la app pide volver a entrar y reintenta.

---

## 7. Migración de datos existentes (no destructiva y reversible)

Patrón expandir → rellenar → restringir, en **una** migración revisable, con `down.sql` escrito y probado en la BD de pruebas
(Prisma no tiene "down"; se guarda en la carpeta de la migración y **no** se ejecuta solo).

Orden:
1. `ALTER TABLE "User"`: `phone DROP NOT NULL`; agregar `username`, `tokenVersion DEFAULT 0`, `mustChangePin DEFAULT false`,
   `deactivatedAt`, `pinChangedAt`, `lastLoginAt`.
2. Verificar antes de seguir: todo usuario existente tiene `role = 'OWNER'` o se le asigna; **cada tienda queda con exactamente
   un OWNER** (si alguna tuviera varios, la migración se detiene y reporta; no elige por su cuenta).
3. `Store.code`: columna nullable → relleno → `NOT NULL` + `UNIQUE`.
4. Crear `RateLimit` y `AuthEvent`.
5. Renombrar `userId → createdByUserId` (con sus FK) en `Sale` y `Payment`; agregar `voidedByUserId` (+ FK compuesta).
6. CHECKs: rol/phone/username, índice parcial de OWNER único, `createdByUserId IS NOT NULL NOT VALID`, simetría de anulación.

`down.sql`: deshace en orden inverso. Dos límites honestos: devolver `phone` a `NOT NULL` solo funciona **mientras no haya empleados
sin celular**, y los datos escritos en columnas nuevas (usuarios, autoría de ventas posteriores) se pierden al volver atrás.
Ningún dato original se modifica ni se borra.

Se aplica primero a la BD de **pruebas**, luego (con tu aprobación) a desarrollo, con el mismo procedimiento que R1
(URL directa, `migrate deploy`, verificación en `pg_constraint`).

---

## 8. Pruebas (lista concreta)

**Integración (BD de pruebas)**
- Aislamiento: el mismo `username` en dos tiendas es válido; repetido en la misma, `P2002`; el código de tienda es único; un
  EMPLOYEE de la tienda A no puede leer ni escribir datos de B a través de `route()`/`storeDb`.
- Un solo OWNER por tienda (el segundo se rechaza); OWNER sin celular y EMPLOYEE sin usuario se rechazan por CHECK.
- Autoría: crear venta/abono guarda el `createdByUserId` de la sesión; un `createdByUserId` en el `data` se rechaza; anular guarda
  `voidedByUserId`; `voidedAt` sin `voidedByUserId` se rechaza; `createdByUserId` de otra tienda se rechaza por FK.
- Migración: sobre una copia con usuarios y ventas sembrados con el schema viejo, tras migrar todos quedan OWNER, ninguna fila
  se pierde, las ventas viejas conservan su autor (o NULL), y `down.sql` devuelve el esquema anterior.
- Revocación: desactivar a un empleado hace que su siguiente request dé 401; `tokenVersion+1` invalida el token anterior;
  tienda con `isActive=false` también.
- Bloqueo: 5 fallos → 6.º intento bloqueado aunque el PIN sea el correcto; una cuenta inexistente se bloquea igual y con el mismo
  mensaje; tras el tiempo de bloqueo vuelve a funcionar; éxito limpia el contador; el OWNER desbloquea a un empleado; el límite por IP.
- Carrera de registro: dos `register` simultáneos con el mismo celular → uno 201 y otro 409 (no 500).

**Unitarias**
- `validatePin` (triviales, secuencias, patrones, igual al celular, años); normalización y alfabeto del código de tienda;
  `can()` contra la matriz completa (tabla de verdad); generación del código (sin caracteres ambiguos, longitud).

**De rutas / contrato**
- EMPLOYEE recibe 403 en cada acción prohibida (anular venta/abono, precios, archivar cliente, estadísticas de ganancia,
  empleados, ajustes) y 200 en las permitidas. OWNER recibe 200.
- Sin cookie → 401; token con firma mala o `tv` viejo → 401; `mustChangePin` bloquea todo salvo `pin.change`.
- El test de cobertura de §4.4 (todas las rutas envueltas).
- Cookie: atributos `httpOnly`, `sameSite=lax`, `secure` en producción, prefijo `__Host-`. `Origin` ajeno en POST → 403.
- Tiempos: login con celular inexistente y con celular existente y PIN malo tardan lo mismo (tolerancia amplia; el test comprueba que
  ambos llaman a `compare`, no mide milisegundos).

---

## 9. Pasos de implementación (cada uno verificable)

| # | Paso | Criterio de aceptación |
|---|---|---|
| **1** | **Schema + migración** (§2 y §7) con `down.sql`; tests de integración de constraints y de migración | `migrate deploy` limpio en pruebas; `down.sql` probado; los tests de BD de §8 pasan; `migrate status` limpio; sin tocar dev |
| **2** | **Núcleo de sesión y autorización**: token mínimo con `tv`, `getSession()` con BD, cookie endurecida, middleware delgado + `Origin`, `lib/authz.ts` (matriz), `route()`/`publicRoute()`, regla ESLint y test de cobertura; las consultas de `app/api/auth` pasan a `lib/` (se retira la excepción de ESLint) | Tests de revocación, 401/403 y cobertura pasan; ESLint falla si una ruta no se envuelve; medida de latencia de `getSession()` reportada |
| **3** | **Registro y login OWNER seguros**: `validatePin`, `RateLimit` + bloqueo, igualación de tiempos, 409 en carrera, código de tienda, `AuthEvent`, logout/cambio de PIN/cerrar todas | Tests de bloqueo, de PIN y de registro pasan; el OWNER existente entra con su PIN actual (tras re-login único) |
| **4** | **Empleados**: alta/baja/reseteo/desbloqueo, login de empleado, `mustChangePin`, `storeDb({storeId,userId})` con autoría y `void`, pantallas mínimas (login con código, Ajustes › Empleados) | Un empleado inicia sesión, registra una venta con su autoría, no puede anular (403); al desactivarlo su siguiente request da 401 |
| **5** | **Endurecimiento y contrato de sync**: pepper del PIN con rehash al iniciar sesión, retención de `AuthEvent`/`RateLimit`, contrato de autoría offline documentado y con tests de la regla de §6.4 | Los hashes antiguos siguen funcionando y se reemplazan al entrar; tests de la regla de sync pasan |

Cada paso cierra con `typecheck`, `lint`, `test`, `test:integration` y `build` verdes, y se entrega con su reporte antes de empezar el siguiente.

---

## 10. Riesgos y deuda (qué queda fuera y por qué)

- **Pepper del PIN [DECIDIR 9]**: un PIN de 4–6 dígitos tiene 10⁴–10⁶ combinaciones; si la BD se filtra, `bcrypt` no alcanza (con
  4 dígitos se prueba todo en minutos). *Recomiendo* aplicar un HMAC con un secreto del servidor (`PIN_PEPPER`, distinto de `JWT_SECRET`)
  antes de `bcrypt`, con rehash al iniciar sesión (paso 5, para no bloquear el resto). Costo: gestionar un secreto más; si se pierde,
  nadie puede entrar.
- **Recuperación de PIN del OWNER**: no existe en el MVP. Si el dueño olvida su PIN solo se puede resetear a mano (lo que hicimos con el
  script de desarrollo), con verificación de identidad fuera de la app. Queda para después: OTP por WhatsApp/SMS (costo por mensaje y
  proveedor), con su propio diseño.
- **2FA, lista de dispositivos y cierre de sesión por dispositivo**: no entran. La opción B de revocación permite migrar a eso después.
- **Enumeración de celulares en el registro** (409 "ya está registrado"): se mitiga con el límite por IP, no se elimina; es el
  compromiso de usabilidad (el tendero necesita saber que ya tiene cuenta).
- **Rotación de `JWT_SECRET`**: cambiarlo cierra todas las sesiones; no hay rotación gradual (`kid`). Aceptable ahora.
- **Anulación solo del OWNER**: si el empleado se equivoca debe llamar al dueño; es decisión de producto, y hay que vigilar la fricción.
- **Índice parcial de OWNER y Prisma**: posible choque con el detector de drift (§2.1); se verifica en el paso 1.
- **Tokens de la versión actual**: todos los usuarios vuelven a entrar una vez [DECIDIR 11].
- **Dependencia zod**: este trabajo agrega validadores; es buen momento de migrar zod 3→4 (ver `docs/DEUDA_SEGURIDAD.md`), pero se
  hace como tarea separada para no mezclar riesgos. **[DECIDIR 12]** *Recomiendo* separarlo.
- **R1 sigue sin commitear**: este diseño asume el schema de R1 (aplicado en dev). La rama de diseño se creó con el árbol de trabajo
  de R1 sin commitear; antes de empezar el paso 1 hay que commitear R1 en su propia rama.

---

## 11. Lista de decisiones pendientes

| # | Tema | Recomendación |
|---|---|---|
| 1 | Revocación de sesiones | A: `tokenVersion`; logout solo borra la cookie |
| 2 | Duración del token | 30 días deslizantes, tope 90 desde el último login |
| 3 | Largo del código de tienda | 6 caracteres, alfabeto sin ambiguos |
| 4 | Celular de empleados | Único global y opcional (limitación aceptada) |
| 5 | Permisos con `?` en la matriz | Empleado crea clientes; no edita, no archiva, no inventario, "Hoy" propio sin ganancia, cierre de caja solo OWNER |
| 6 | PIN de empleado | Temporal generado + cambio obligatorio |
| 7 | Largo del PIN y umbrales de bloqueo | 4–6 dígitos con lista de triviales; 5 fallos/15 min, bloqueo progresivo hasta 1 h; IP 30/10 min |
| 8 | Autoría | Renombrar `userId → createdByUserId`; NULL histórico sin inventar autor (`NOT VALID`) |
| 9 | Pepper del PIN | Sí, en el paso 5 |
| 10 | Regla de autoría offline | La acepta el mismo usuario o el OWNER; baja ⇒ solo lo anterior a `deactivatedAt` |
| 11 | Sesiones existentes | Forzar un re-login |
| 12 | Migración de zod | Tarea separada |
