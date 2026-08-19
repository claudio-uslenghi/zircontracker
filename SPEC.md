# Spec: Tareas + Carga de Horas Self-Service + Rol Colaborador

## Objective

Hoy la app (`gantt-app` / Zircon Planner) es administrada 100% por el admin: las horas se cargan por importación masiva (Clockify, Excel SCC, CSV) y no existe ningún concepto de "tarea" dentro de un proyecto.

Este spec abre la carga de horas a usuarios finales, al estilo Clockify, con dos modalidades (detallada por tarea vía matriz semanal, y bulk mensual para gente Time & Material), más un nuevo rol "colaborador" con acceso acotado a un puñado de pantallas. El admin mantiene control total: crea las tareas, conserva todos los flujos de importación masiva existentes, y gana un nuevo rol para asignar.

**Éxito** = un usuario cuyo email matchea un `Resource` puede loguearse, ver solo las pantallas permitidas, cargar horas de ambas formas, editar/borrar solo sus propias entradas, cargar sus propias vacaciones, cambiar su contraseña — y ningún endpoint de escritura acepta acciones fuera de su propio `resourceId` aunque se llame directo a la API.

Fuera de alcance de este spec (iniciativas separadas a planificar después): migración del repositorio a la organización de GitHub de Zircontech, y auditoría/reorganización de la estructura general del proyecto.

## Hallazgos clave de la exploración

- **`User` (login) y `Resource` (persona) son tablas separadas sin vínculo.** `Resource` no tiene campo `email`. Hay que agregarlo y vincular por igualdad exacta de email (no la heurística de iniciales que usa hoy el import de Clockify).
- **Permisos son por página, todo-o-nada** (`Role` → `PagePermission`, admin bypass total). No hay noción de "solo lectura" dentro de una página — hay que agregar chequeos de rol condicionales en el cliente **y** endurecer las rutas de escritura en el servidor.
- **`/api/projects/[id]` (PUT y DELETE) no tiene ningún check de autenticación/rol hoy** — cualquier sesión válida puede editar/borrar proyectos vía API directa, sin pasar por la UI. Esto se corrige como parte de este trabajo (no es opcional: si no, "colaborador no puede editar proyectos" sería una restricción cosmética).
- **No existe modelo `Task`.** Lo más cercano es `Assignment` (asignación % para el Gantt), que no sirve para carga de horas por tarea.
- `TimeEntry` ya tiene `entryType` (regular/extra) — se reutiliza tal cual, se le agrega `taskId` opcional.

## Decisiones confirmadas

1. **Vínculo User↔Resource**: por email exacto (`Resource.email` nuevo, único, nullable).
2. **Tareas**: solo el admin puede crear/editar/borrar `Task` por proyecto.
3. **Colaborador — acceso**:
   - `/projects`: solo lectura (ve listado, no crea/edita/borra).
   - `/holidays`: feriados en solo lectura; **vacaciones puede cargar las propias** (nueva auto-gestión, acotada a su propio `resourceId`).
   - Puede cambiar su propia contraseña (nueva pantalla de perfil, disponible para cualquier usuario autenticado, no solo colaboradores).
4. **Carga de horas** reutiliza los mismos datos que ya existen (`TimeEntry`: resourceId, projectId, date, hours, entryType) + `taskId` opcional nuevo.
5. **Modo detallado (día a día)**: permite **varias tareas distintas el mismo día** (estilo Clockify real) → el unique constraint de `TimeEntry` debe incluir `taskId`.
6. **Modo T&M (bulk mensual)**: para usuarios Time & Material que no discriminan por tarea. Autocompleta el mes salteando **solo fines de semana** (no cruza feriados/vacaciones — el usuario ajusta manualmente esos días). `taskId` queda `null` en estas entradas.
7. **Reporte propio**: el colaborador ve únicamente sus propias horas, filtrado server-side por su `resourceId` resuelto de sesión — nunca ve datos de otros recursos.
8. **UI de carga detallada = matriz semanal, no popups.** En vez de un modal por cada entrada, `/mis-horas` (modo detallado) muestra una grilla tipo Clockify: filas = tareas (del proyecto elegido), columnas = los 7 días de la semana seleccionada, celdas editables inline. Agregar una tarea a la grilla suma una fila nueva; cada celda es un input de horas que guarda al salir del campo (blur) o con autosave con debounce. Fila de "Total del día" al pie y "Total de la semana" por fila — mismo lenguaje visual que ya usa `admin/daily-report` (celdas fijas, sticky headers).

## Tech Stack

Sin cambios: Next.js 14.2 App Router, Prisma 5.22 + Turso/libSQL, NextAuth 4 (JWT, credentials + bcryptjs), TanStack Query v5, Tailwind, lucide-react. Sin librerías nuevas.

## Commands

```
Dev:    npm run dev
Build:  npm run build
Lint:   npm run lint
Types:  npx tsc --noEmit
Migrar: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/<nueva>.ts
```

## Project Structure

```
app/
  perfil/page.tsx              → cambio de contraseña (todos los usuarios)
  mis-horas/page.tsx           → selector semana + proyecto → grilla tareas×días (inline, sin popups) + toggle a modo bulk T&M
  mi-reporte/page.tsx          → pivot de solo-sus-horas (reutiliza lógica de admin/daily-report)
  api/tasks/route.ts           → GET (por projectId), POST (admin)
  api/tasks/[id]/route.ts      → PUT/DELETE (admin)
  api/me/resource/route.ts     → resuelve session → Resource propio
  api/me/time-entries/route.ts → GET (semana/mes), PUT upsert por celda (resourceId+projectId+taskId+date+entryType), POST bulk T&M, DELETE — todo acotado a resourceId propio
  api/me/password/route.ts     → PATCH, verifica currentPassword + hashea nueva
  api/me/vacations/route.ts    → POST/DELETE, acotado a resourceId propio
prisma/schema.prisma           → +Task, +TimeEntry.taskId, +Resource.email
scripts/add-task-and-email.ts  → migración Turso (idempotente, sigue el patrón de add-entry-type.ts)
```

Páginas existentes que se tocan: `app/projects/page.tsx`, `app/holidays/page.tsx` (render condicional por rol), `app/api/projects/[id]/route.ts` y `app/api/vacations/route.ts` (harden server-side), `lib/auth.ts` (nuevo helper `requireSelfOrAdmin`).

## Code Style

Seguir el patrón ya establecido en el repo (ver `app/api/time-entries/route.ts`, `app/admin/daily-report/page.tsx`): rutas API con `export const dynamic = 'force-dynamic'`, `NextResponse.json`, tipos compartidos en `types/index.ts`, componentes cliente con `'use client'` + TanStack Query, estilos Tailwind + algún inline style puntual para tablas pivot.

Nuevo helper en `lib/auth.ts`:

```typescript
export async function requireSelfOrAdmin(resourceId: number) {
  const session = await getSession()
  const roles = getUserRoles(session)
  if (roles.includes('admin')) return session!
  const resource = await prisma.resource.findUnique({ where: { email: session?.user?.email ?? '' } })
  if (!resource || resource.id !== resourceId) throw new Error('Forbidden')
  return session!
}
```

## Testing Strategy

No hay suite automatizada en el repo — se mantiene el patrón manual ya usado: `npx tsc --noEmit` + QA manual en navegador (login como colaborador de prueba, probar cada flujo). Dado que `/api/me/*` es la superficie de seguridad más sensible (un colaborador no debe poder tocar datos de otro resourceId), se recomienda verificación manual explícita de "llamar la API directo con un resourceId ajeno y confirmar 403" antes de mergear, aunque no haya tests automatizados formales.

## Boundaries

- **Always**: hashear contraseñas con bcryptjs (patrón existente); todo endpoint de escritura nuevo pasa por `requireAdmin()` o `requireSelfOrAdmin()`; resolver `resourceId` siempre server-side desde la sesión, nunca confiar en un `resourceId` que mande el cliente.
- **Ask first**: correr la migración de schema contra Turso de producción; crear el rol "colaborador" y sus `PagePermission` en datos de producción; cualquier cambio a los flujos de importación masiva existentes (Clockify/SCC/CSV) — no deberían tocarse en este trabajo.
- **Never**: permitir que una request con rol colaborador lea o escriba `TimeEntry`/`Vacation` de un `resourceId` que no sea el propio; exponer password hashes; remover o alterar las pantallas `/admin/*` existentes.

## Cambios de datos (`prisma/schema.prisma`)

```prisma
model Resource {
  // ...existente...
  email String? @unique
}

model Task {
  id        Int      @id @default(autoincrement())
  projectId Int
  name      String
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  project    Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  timeEntries TimeEntry[]
}

model TimeEntry {
  // ...existente...
  taskId Int?
  task   Task? @relation(fields: [taskId], references: [id], onDelete: SetNull)

  @@unique([resourceId, projectId, date, entryType, taskId])
}
```

**Nota técnica**: SQLite/Turso trata cada `NULL` como distinto en un índice único, así que el constraint no evita duplicados cuando `taskId` es `null` (caso T&M). El endpoint `/api/me/time-entries` para el modo T&M debe hacer "buscar entrada existente (resourceId+projectId+date+entryType+taskId IS NULL) y actualizar, si no existe insertar" en vez de confiar ciegamente en el `INSERT ... ON CONFLICT`.

Migración (`scripts/add-task-and-email.ts`): agrega columna `email` a `Resource`, crea tabla `Task`, agrega columna `taskId` a `TimeEntry`, recrea el índice único — todo idempotente, siguiendo el patrón de `scripts/add-entry-type.ts`.

## Success Criteria

1. Admin crea un `Resource` con email igual al de un `User` colaborador de prueba → el colaborador puede loguearse y el sistema resuelve su `resourceId`.
2. Admin crea 2-3 `Task` en un proyecto.
3. Colaborador entra a `/mis-horas`, elige proyecto y semana → aparece la grilla (filas = tareas, columnas = Lun-Dom). Agrega Tarea A y Tarea B como filas, escribe 3h y 2h en la misma columna (mismo día) → ambas celdas guardan sin popups, la fila "Total del día" refleja 5h.
4. Colaborador usa el modo T&M: elige proyecto + mes, autocompleta 8h en días hábiles (fines de semana salteados), edita un par de días manualmente, guarda → se crean/actualizan las filas correspondientes con `taskId = null`.
5. Colaborador ve `/mi-reporte` → solo sus propias horas, ningún otro recurso aparece.
6. Colaborador entra a `/projects` → ve el listado, no ve botones Nuevo/Editar/Eliminar; si llama `PUT /api/projects/1` directo con curl/fetch, recibe 403.
7. Colaborador entra a `/holidays` → ve feriados sin botón de agregar; puede cargar su propia vacación; si intenta borrar una vacación de otro `resourceId` vía API, recibe 403.
8. Colaborador entra a `/perfil`, cambia su contraseña, puede loguearse de nuevo con la nueva.
9. Flujos de admin existentes (import Clockify/SCC/CSV, control-horas, daily-report) siguen funcionando sin cambios.
10. `npx tsc --noEmit` pasa sin errores.

## Open Questions

- Campos de `Task` más allá de `name` y `active` (¿estimatedHours? ¿fechas?) — se propone mínimo viable, ampliable después.
- Alcance exacto de páginas vedadas al colaborador (`/gantt`, `/resources`, `/admin/*`, `/admin/control-horas`) se resuelve por el modelo default-deny de `PagePermission` ya existente — no requiere cambios de modelo, solo no otorgarle esos permisos al rol.

---

# Spec: Rediseño "Mis Horas" estilo Clockify + Mobile en toda la app

## Objective

El modo detallado de `/mis-horas` obliga hoy a elegir **un** proyecto arriba de la grilla antes de poder cargar nada, y agregar filas es un flujo de dos pasos separado de la tabla. El usuario adjuntó una captura de Clockify: ahí cada **fila** de la matriz es un proyecto+tarea elegido de forma independiente ("Internal Issues: Presales", "MOB Mantenimiento: Requerimientos Nicolas"), con una fila especial "+ Seleccionar proyecto" al pie para agregar más, y un botón `✕` a la derecha de cada fila para eliminarla.

Este spec tiene dos partes:
1. Rediseña el modo detallado de `/mis-horas` para igualar ese flujo de Clockify.
2. Adapta a mobile **todas las páginas de la app excepto Gantt y Control de Horas** — esas dos se excluyen a propósito porque son tablas/vistas anchas por naturaleza (grilla de fechas de meses/años, matriz de presupuesto por proyecto) donde forzar mobile degradaría la herramienta sin aportar valor real; se usan casi siempre desde escritorio.

**Éxito** = un colaborador puede, sin salir de la grilla semanal de `/mis-horas`: agregar una fila eligiendo proyecto y tarea, cargar horas de varios proyectos distintos en la misma semana, eliminar una fila (con confirmación si tiene horas cargadas) — y además, cualquier página de la app (salvo Gantt y Control de Horas) es usable desde un celular: se navega, se lee y se puede operar sin scroll horizontal de página completa ni elementos cortados. El modo Time & Material y el resto de la lógica de negocio no cambian.

## Hallazgos clave

- **No hace falta tocar el backend.** `GET /api/me/time-entries` sin `projectId` ya devuelve las entradas de toda la semana en cualquier proyecto; `GET /api/tasks` sin `projectId` ya devuelve todas las tareas. `Task.id` es un ID global (no reutilizado entre proyectos), así que las filas se pueden seguir indexando por `taskId` solo, sin necesitar una clave compuesta con `projectId`.
- No existe un endpoint de borrado masivo — `DELETE /api/me/time-entries?id=` borra una sola entrada. Para "eliminar fila" alcanza con disparar un `DELETE` por cada entrada de esa tarea en la semana visible (como mucho 7 llamadas), sin agregar endpoints nuevos.
- Las dimensiones de columna hoy son un objeto `style` fijo en píxeles (`NAME_W`, `CELL_W`), no clases de Tailwind — para achicarlas en mobile hace falta un breakpoint leído en JS (`window.matchMedia` / hook de resize), no alcanza con clases responsive directas sobre esos estilos inline.
- **El sidebar (`components/layout/Sidebar.tsx`) es fijo y ocupa 208px (o 64px colapsado) en TODAS las pantallas**, incluidas Gantt y Control de Horas. En un viewport de 375px eso deja ~165px para el contenido — ninguna página individual queda usable en mobile si esto no se resuelve primero. Es un cambio de shell, no de una página puntual, y beneficia a todas las páginas en alcance (incluida su versión mobile del propio Gantt/Control de Horas si el usuario los abre desde el celular, aunque esas dos no se rediseñen puertas adentro).
- Inventario de páginas de la app (`app/**/page.tsx`):

  | Página | En alcance mobile |
  |---|---|
  | `/mis-horas` | Sí — ya cubierta arriba (rediseño Clockify + mobile) |
  | `/mi-reporte` | Sí |
  | `/projects` | Sí |
  | `/resources` | Sí |
  | `/holidays` | Sí |
  | `/perfil` | Sí (ya es simple, ajustes menores) |
  | `/login` | Sí (ya es simple, ajustes menores) |
  | `/unauthorized` | Sí (ya es simple, ajustes menores) |
  | `/admin/users` | Sí |
  | `/admin/roles` | Sí |
  | `/admin/permissions` | Sí |
  | `/admin/daily-report` | Sí |
  | `/admin/hours` | Sí (tabs de import + tabla/resumen/gráficos) |
  | `/gantt` | **No** — excluida a pedido |
  | `/admin/control-horas` | **No** — excluida a pedido |

## Decisiones confirmadas

1. **Selector de proyecto único → picker por fila (`/mis-horas`).** Se saca el `<select>` de proyecto de arriba de la grilla. La fila "+ Seleccionar proyecto" al pie abre un picker de dos pasos (Proyecto → Tarea, reutilizando `<select>` simples como en el resto del repo) y agrega la fila a la grilla.
2. **Eliminar fila con horas cargadas**: pide confirmación (`confirm()`, mismo patrón que ya usa el resto de la app) y borra las entradas de esa fila para la semana visible. Sin horas, se quita directo sin confirmar.
3. **Modo Time & Material**: no se toca. Sigue en su pestaña separada, sin cambios de UI ni de comportamiento.
4. **Alcance de mobile: toda la app salvo Gantt y Control de Horas** (tabla de arriba). Esas dos quedan como están, en desktop, sin ningún ajuste.
5. **Sidebar → shell responsive.** Bajo un breakpoint (`< 768px`, mismo criterio que usa `resize_window` mobile del navegador de pruebas), el sidebar deja de ocupar espacio fijo: se colapsa a un drawer off-canvas que se abre con un botón hamburguesa en una barra superior nueva, y se cierra al elegir una página o tocar afuera. Arriba del breakpoint, el sidebar actual (expandible/colapsable) no cambia.
6. **Tratamiento por tipo de página** (aplicado a cada página en alcance):
   - **Tablas tipo pivot** (`/mi-reporte`, `/admin/daily-report`, la parte de feriados/vacaciones de `/holidays`): mismo patrón que ya se define para `/mis-horas` — scroll horizontal, primera columna `sticky`, columnas más angostas y texto ≥16px en inputs bajo el breakpoint mobile.
   - **Tablas de listado con acciones** (`/projects`, `/resources`, `/admin/users`, `/admin/roles`, `/admin/permissions`): scroll horizontal con la columna de nombre fija; si una tabla es angosta de por sí (pocas columnas, ej. `/admin/roles`), alcanza con que el contenedor no desborde el body.
   - **Pantallas de formulario/tabs** (`/admin/hours`): los tabs (Importar/Tabla/Resumen/Gráficos) y los controles de import (Clockify/CSV/SCC) pasan a apilarse verticalmente bajo el breakpoint en vez de quedar en fila.
   - **Pantallas simples** (`/perfil`, `/login`, `/unauthorized`): ya son angostas por diseño (`max-w-md` o similar) — solo se verifica que no haya overflow ni texto cortado.

## Tech Stack

Sin cambios — ver spec anterior. No se agregan librerías ni endpoints.

## Project Structure

Archivos que se tocan (todos ya existentes, ninguno nuevo):
```
components/layout/Sidebar.tsx      → drawer off-canvas + botón hamburguesa bajo el breakpoint
components/layout/AuthLayout.tsx   → barra superior mobile con el toggle del drawer
app/mis-horas/page.tsx             → reescritura del modo detallado (picker por fila) + mobile; modo T&M intacto
app/mi-reporte/page.tsx            → mobile
app/projects/page.tsx              → mobile
app/resources/page.tsx             → mobile
app/holidays/page.tsx              → mobile
app/perfil/page.tsx                → mobile (ajustes menores)
app/login/page.tsx                 → mobile (ajustes menores)
app/unauthorized/page.tsx          → mobile (ajustes menores)
app/admin/users/page.tsx           → mobile
app/admin/roles/page.tsx           → mobile
app/admin/permissions/page.tsx     → mobile
app/admin/daily-report/page.tsx    → mobile
app/admin/hours/page.tsx           → mobile
```
Explícitamente **no** se tocan: `app/gantt/page.tsx`, `app/admin/control-horas/page.tsx`.

## Code Style

Mismo patrón que ya usa cada archivo: componente cliente + TanStack Query, `<select>` planos para pickers (no autocomplete/combobox nuevo), estilos inline `style={{}}` para las celdas de tablas pivot (igual que `admin/daily-report`) + clases Tailwind para el resto. El hook de "es mobile" se resuelve una sola vez, compartido, con `useEffect` + `window.matchMedia('(max-width: 767px)')` (mismo corte que usa `resize_window` del navegador de pruebas), sin librerías nuevas — se puede extraer a `lib/use-is-mobile.ts` para no repetirlo en cada página.

## Testing Strategy

Igual que el resto del proyecto: sin suite automatizada, `npx tsc --noEmit` + QA manual en navegador. Para esta feature en particular, verificar manualmente:
- Cargar horas en 2 proyectos distintos la misma semana sin recargar la página.
- Eliminar una fila con horas → aparece confirmación → se borran las entradas de esa fila (verificar contra la DB o recargando la grilla).
- Eliminar una fila sin horas → se quita sin confirmación.
- `resize_window` a `mobile` (375×812) en **cada página en alcance** (ver tabla de arriba): el sidebar se colapsa a drawer con hamburguesa, ninguna página tiene scroll horizontal de body completo (solo scroll horizontal dentro del contenedor de tabla cuando corresponde), no hay texto cortado ni botones inalcanzables.
- `resize_window` a `mobile` en `/gantt` y `/admin/control-horas`: confirmar que siguen exactamente igual que antes (sin cambios), aparte de heredar el drawer del sidebar.

## Boundaries

- **Always**: mantener el estilo visual ya establecido (paleta `#0170B9`/`#005a94`/`#1e3a5f`, sticky headers, mismo lenguaje que `admin/daily-report`); resolver siempre `resourceId` server-side (sin cambios acá, ya está resuelto).
- **Ask first**: nada nuevo — no hay cambios de datos ni de permisos en este spec.
- **Never**: tocar el modo T&M, los endpoints de `/api/me/time-entries` o `/api/tasks`, el contenido/lógica de `/gantt` o `/admin/control-horas` (solo heredan el drawer del shell, nada más).

## Success Criteria

1. `/mis-horas` (modo detallado) ya no tiene selector de proyecto arriba de la grilla.
2. La fila "+ Seleccionar proyecto" al pie de la tabla permite elegir proyecto y tarea, y agrega una fila nueva rotulada "Proyecto: Tarea".
3. Se puede cargar horas en filas de 2 proyectos distintos la misma semana, ambas visibles en la misma grilla.
4. El botón `✕` de una fila con horas pide confirmación antes de borrar; una fila sin horas se quita directo.
5. El modo Time & Material sigue funcionando exactamente igual que antes.
6. En viewport mobile (375px), el sidebar se colapsa a un drawer con botón hamburguesa, en todas las páginas.
7. En viewport mobile, cada página de la tabla de alcance (todas menos `/gantt` y `/admin/control-horas`) es usable: sin scroll horizontal de body completo, sin texto cortado, sin botones inalcanzables.
8. `/gantt` y `/admin/control-horas` quedan sin cambios de contenido — solo heredan el drawer del sidebar.
9. `npx tsc --noEmit` y `npm run build` pasan sin errores.
