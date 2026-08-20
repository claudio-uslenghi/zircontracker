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

---

# Spec: Combos de proyecto y persona ordenados + buscables

## Objective

Los `<select>` de proyecto en la app salen en un orden que no tiene sentido para el usuario (por fecha de inicio, no alfabético), y son selects nativos sin forma de escribir para filtrar — con 30+ proyectos hay que scrollear la lista entera para encontrar uno. Este spec ordena alfabéticamente y agrega búsqueda por texto a todos los combos de proyecto de la app (excepto Gantt, que queda afuera a pedido explícito), y agrega búsqueda al combo de "Persona" del Reporte Diario (ese ya viene ordenado alfabéticamente desde el backend).

**Éxito** = en cada combo en alcance, las opciones aparecen ordenadas A-Z, y escribir en el campo filtra la lista en tiempo real por coincidencia de texto (sin distinguir mayúsculas/minúsculas), con navegación por teclado (flechas + Enter + Escape) igual que un combobox estándar.

## Hallazgos clave

- **La causa raíz del desorden es una sola línea**: `GET /api/projects` usa `orderBy: { startDate: 'asc' }` en vez de `{ name: 'asc' }`. Cambiar esto ahí ordena automáticamente casi todos los combos de proyecto de la app, porque todos comparten ese mismo endpoint vía `useQuery(['projects'], ...)`.
- `GET /api/resources` ya ordena por `{ name: 'asc' }` — el combo de "Persona" del Reporte Diario ya está alfabético, solo le falta la búsqueda por texto.
- **Gantt y Control de Horas quedan afuera** (confirmado con el usuario): sus filtros de proyecto no son `<select>` sino widgets propios de multi-selección por checkboxes, alimentados por endpoints separados (`/api/gantt`, `/api/control-horas`), y ya habían quedado explícitamente excluidos de la tanda de cambios anterior.
- Inventario de combos de proyecto en alcance (todos `<select>` nativos hoy):

  | Archivo | Combo(s) |
  |---|---|
  | `app/mis-horas/page.tsx` | Proyecto (modo T&M) + Proyecto (picker de fila, modo detallado) |
  | `app/mi-reporte/page.tsx` | Proyecto (filtro) |
  | `app/admin/daily-report/page.tsx` | Proyecto (filtro) + **Persona (filtro)** |
  | `app/admin/hours/page.tsx` | Proyecto (import SCC), Proyecto (filtro tabla), Proyecto (alta inline), Proyecto (edición inline) |

  9 combos en total (8 de proyecto + 1 de persona) en 4 archivos.
- Un `<select>` nativo del navegador no soporta escribir-para-filtrar — hace falta reemplazarlo por un combobox propio (input de texto + lista desplegable filtrada), no hay forma de lograrlo con el elemento nativo.

## Decisiones

1. **Fix de orden**: `app/api/projects/route.ts` — `orderBy: { startDate: 'asc' }` → `orderBy: { name: 'asc' }`. Un solo cambio, beneficia a todos los consumidores del endpoint.
2. **Componente nuevo y reutilizable**: `components/ui/SearchableSelect.tsx` — combobox con input de texto + panel desplegable, mismo estilo visual (borde, radio, tamaño de fuente) que los `<select>` que reemplaza. Filtra por coincidencia de substring, sin distinguir mayúsculas/minúsculas. Soporta teclado (↑/↓ para navegar, Enter para elegir, Escape para cerrar sin cambiar) y cierre al hacer click afuera.
3. **Alcance confirmado**: los 9 combos de la tabla de arriba. Gantt (incluido el modal "Nueva Asignación") y Control de Horas quedan completamente afuera.

## Tech Stack

Sin cambios, sin librerías nuevas — se construye con React + Tailwind, mismo patrón que el resto de los componentes de la app.

## Project Structure

```
components/ui/SearchableSelect.tsx   → nuevo, componente reutilizable
app/api/projects/route.ts            → orderBy: name asc (1 línea)
app/mis-horas/page.tsx               → 2 combos reemplazados
app/mi-reporte/page.tsx              → 1 combo reemplazado
app/admin/daily-report/page.tsx      → 2 combos reemplazados (proyecto + persona)
app/admin/hours/page.tsx             → 4 combos reemplazados
```

## Code Style

`SearchableSelect` recibe `options: { value: string; label: string }[]`, `value`, `onChange`, y un `placeholder` — misma forma que ya arman todos los call sites hoy a partir de `projects.map(...)`, así que el reemplazo en cada página es mecánico: se arma el array de `options` una vez (con el `.sort()` ya innecesario para proyecto gracias al fix del punto 1, pero se aplica igual por si el consumidor cachea datos viejos) y se pasa al componente en vez de escribir el `<option>` a mano.

## Testing Strategy

Sin suite automatizada — `npx tsc --noEmit` + QA manual: escribir un par de letras en cada combo y confirmar que filtra, confirmar que las listas aparecen A-Z, navegar con teclado, confirmar que Gantt y Control de Horas no se tocaron (`git diff`).

## Boundaries

- **Always**: mantener el valor seleccionado como string (mismo tipo que ya usan los `value`/`onChange` existentes) para no romper la lógica de cada página.
- **Ask first**: nada nuevo.
- **Never**: tocar `components/gantt/GanttControls.tsx`, `app/admin/control-horas/page.tsx`, `components/modals/AssignmentModal.tsx`, ni ningún otro combo de persona fuera del de `admin/daily-report`.

## Success Criteria

1. `GET /api/projects` devuelve los proyectos ordenados por nombre.
2. Los 8 combos de proyecto listados arriba muestran las opciones A-Z y filtran al escribir.
3. El combo de Persona de `admin/daily-report` filtra al escribir (el orden ya estaba bien).
4. Navegación por teclado (↑/↓/Enter/Escape) funciona en el nuevo componente.
5. `git diff` confirma cero cambios en Gantt, Control de Horas y `AssignmentModal.tsx`.
6. `npx tsc --noEmit` y `npm run build` pasan sin errores.

---

# Spec: Dashboard inicial, fix acceso colaborador, y UX de Mis Horas

## Objective

Cuatro correcciones relacionadas de experiencia de usuario y un bug de acceso:

1. El mensaje "Acceso denegado" siempre ofrece "Ir al Gantt", aunque el rol del usuario no tenga acceso al Gantt (lo vuelve a mandar al mismo error).
2. `cuslenghi@zircon.tech` (rol colaborador) "no puede loguearse".
3. No existe una pagina de inicio neutral: hoy `/` redirige siempre a `/gantt`, y los roles sin acceso a esa pagina (como colaborador) quedan sin landing page valida.
4. En Mis Horas: el combo de proyecto del selector de fila no se expande (se corta), el boton de borrar fila queda visualmente fuera de la tabla, y usa una "X" en vez del icono de tacho de basura rojo que se usa en el resto de la app.

## Hallazgos clave de la exploracion

- **Los puntos 1, 2 y 3 son el mismo bug.** Confirmado contra la base real: el usuario `cuslenghi@zircon.tech` existe, esta activo, tiene el `Resource` vinculado correctamente por email, y su rol `colaborador` tiene `allowedPages = ['/projects', '/holidays', '/mis-horas', '/mi-reporte']` — **no incluye `/gantt`**. El login (NextAuth `authorize()`) funciona bien y si genera sesion. Pero `app/page.tsx` hace `redirect('/gantt')` incondicionalmente, y el middleware (`middleware.ts`) rebota cualquier ruta fuera de `allowedPages` a `/unauthorized`. Resultado: el colaborador entra con usuario/contrasena correctos y aterriza directo en la pantalla de "Acceso denegado" — indistinguible, desde su perspectiva, de "no puedo loguearme". Y esa misma pantalla de error lo manda de vuelta a `/gantt`, un loop.
- El unico mecanismo hoy para saltarse el matrix de `PagePermission` es la lista `ALWAYS_ALLOWED_AUTHENTICATED` en `middleware.ts` (hoy solo tiene `/perfil`).
- No existe ninguna pagina de inicio/resumen hoy. Los datos para armar una (cantidad de usuarios, proyectos, feriados) ya estan disponibles via `prisma.user.count()`, `prisma.project.count()` (o el `GET /api/projects` existente) y `GET /api/country-holidays` (ya devuelve feriados ordenados por pais y fecha).
- `Sidebar.tsx` filtra los items de nav por `allowedPages` para no-admins; el Dashboard debe listarse ahi para todos los roles sin depender de esa lista (mismo trato que `/perfil`, que ni siquiera esta en `NAV_ITEMS` — hay que agregar un item fijo, no condicionado).
- **Causa raiz del combo que "no se expande" en Mis Horas**: el picker de proyecto de la fila "Seleccionar proyecto" (`app/mis-horas/page.tsx`) vive dentro de un `<div className="overflow-x-auto">` que envuelve la tabla. Por la especificacion CSS, declarar `overflow-x: auto` sin `overflow-y` fuerza a que `overflow-y` compute como `auto` tambien (no quede en `visible`) — asi que el `<div>` de dropdown absoluto de `SearchableSelect` (que se renderiza dentro de esa misma jerarquia) queda recortado por los bordes de ese contenedor scrolleable en vez de flotar libremente. Es un problema del componente `SearchableSelect` en si (cualquier ancestro con overflow no-visible lo recorta), no solo de esta pantalla.
- **Causa raiz de "el boton de borrar fila queda afuera de la tabla" / cabecera mas corta**: la tabla usa `table-layout: fixed`. El `<thead>` tiene columnas para Proyectos + 7 dias + Total (9 columnas), pero cada `<tr>` del `<tbody>` tiene una decima celda extra de 28px para el boton de borrar que **no tiene equivalente en el `<thead>`**. Con `table-layout: fixed`, el ancho de las columnas lo define la primera fila (`<thead>`), asi que esa decima columna del body queda fuera del ancho que la tabla se calculo a si misma.
- El icono de borrar ya tiene un patron consistente en el resto de la app (`app/projects/page.tsx`, `app/holidays/page.tsx`, `app/resources/page.tsx`): `<Trash2 size={14} />` de `lucide-react`, clase `text-red-400 hover:text-red-600`. Mis Horas usa hoy un caracter "X" con `text-gray-300 hover:text-red-500`.
- Revise `Mi Reporte` (`app/mi-reporte/page.tsx`): su combo de proyecto vive en una barra de filtros separada, **fuera** de cualquier contenedor con `overflow` no-visible, asi que no sufre el mismo recorte. No tiene boton de borrar (es un reporte de solo lectura). El unico cambio que le aplica es el fix generico de `SearchableSelect` (portal), que lo hace mas robusto pero no cambia nada visible ahi hoy.

## Decisiones

1. **Nueva pagina `/dashboard`**: resumen visible para **todos** los roles autenticados (incluido colaborador), sin pasar por el matrix de `PagePermission` — mismo mecanismo que `/perfil` (se agrega a `ALWAYS_ALLOWED_AUTHENTICATED` en `middleware.ts`). Muestra: cantidad de usuarios activos, cantidad de proyectos, y los proximos feriados (`CountryHoliday`, ordenados por fecha, ej. los proximos 5-10 a partir de hoy). Se agrega como item fijo en el Sidebar (siempre visible, no filtrado por `allowedPages`), primero en la lista de navegacion.
2. **`/` pasa a redirigir a `/dashboard`** en vez de `/gantt` — asi cualquier rol aterriza en una pantalla valida al loguearse.
3. **"Acceso denegado" apunta a `/dashboard`** en vez de `/gantt` ("Ir al inicio" en vez de "Ir al Gantt") — coherente con el nuevo home universal.
4. **No se toca la logica de permisos de Gantt ni Control de Horas** — el colaborador `cuslenghi@zircon.tech` sigue sin poder entrar a `/gantt` (es el comportamiento esperado por el matrix de roles); lo que se corrige es que ya no quede varado ahi por accidente al loguearse.
5. **`SearchableSelect` se corrige para usar un portal** (`createPortal` a `document.body`), posicionado con `getBoundingClientRect()` del input, recalculado en scroll/resize mientras esta abierto. Esto lo hace inmune a cualquier ancestro con `overflow` recortado — corrige el combo de Mis Horas de raiz y refuerza (sin cambios visibles) los otros 8 combos ya migrados.
6. **Tabla de Mis Horas**: se agrega una celda vacia en el `<thead>` (28px, mismo color de fondo que el resto del header) para que la columna del boton de borrar tenga su contraparte y la tabla calcule su ancho real incluyendola.
7. **Icono de borrar fila** en Mis Horas pasa de "X" texto a `<Trash2 size={14} />`, clase `text-red-400 hover:text-red-600`, igual que Proyectos/Feriados/Recursos.
8. **Mi Reporte**: sin cambios estructurales — se beneficia solo del fix generico de `SearchableSelect` (punto 5).

## Tech Stack

Sin cambios: Next.js 14 App Router, Prisma 5 + Turso, NextAuth 4 (JWT), TanStack Query v5, Tailwind, lucide-react. Sin librerias nuevas — `createPortal` es parte de `react-dom`, ya presente.

## Project Structure

```
app/
  dashboard/page.tsx        -> NUEVO: resumen (usuarios, proyectos, proximos feriados)
  page.tsx                  -> cambia redirect('/gantt') a redirect('/dashboard')
  unauthorized/page.tsx     -> cambia el link/label de "Ir al Gantt" a "Ir al inicio" (/dashboard)
  mis-horas/page.tsx        -> header <th> spacer + icono Trash2 en vez de X
  api/dashboard/summary/route.ts -> NUEVO: GET, cuenta usuarios activos + proyectos, proximos N feriados
middleware.ts                -> agrega '/dashboard' a ALWAYS_ALLOWED_AUTHENTICATED
components/layout/Sidebar.tsx -> agrega item "Dashboard" fijo (no filtrado por allowedPages)
components/ui/SearchableSelect.tsx -> dropdown via createPortal + reposicionamiento en scroll/resize
```

## Code Style

Seguir los patrones ya establecidos: rutas API con `export const dynamic = 'force-dynamic'` + `NextResponse.json`; paginas cliente con `'use client'` + TanStack Query; iconos de `lucide-react`; mismo lenguaje visual de tarjetas/tablas que el resto de la app (fondo blanco, borde `border-gray-200`, rounded-lg). El nuevo endpoint de dashboard no requiere `requireAdmin()` — es de lectura agregada, visible para cualquier sesion valida (igual que el propio middleware ya permite `/dashboard` a cualquier autenticado).

## Testing Strategy

Sin suite automatizada — verificacion manual + `npx tsc --noEmit` + `npm run build`, patron ya usado en todo el repo. Casos a verificar explicitamente:
- Login con `cuslenghi@zircon.tech` aterriza en `/dashboard` (no en `/unauthorized`).
- `/dashboard` es alcanzable por admin y por colaborador, muestra numeros coherentes con la base.
- Un rol sin acceso a una pagina cualquiera, al chocar contra `/unauthorized`, el boton lleva a `/dashboard` y ese destino carga sin rebote.
- En Mis Horas: abrir el combo de proyecto del picker de fila muestra la lista completa (no recortada), aunque la tabla tenga scroll horizontal activo.
- La fila de la tabla y el header de Mis Horas quedan alineados (el boton de borrar ya no sobresale del borde de la tabla).
- El icono de borrar fila es el tacho rojo, visualmente consistente con Proyectos/Feriados/Recursos.
- Gantt y Control de Horas: sin cambios (confirmar con `git diff --stat`).

## Boundaries

- **Always**: resolver `/dashboard` como visible-para-todos via el mismo mecanismo que `/perfil` (`ALWAYS_ALLOWED_AUTHENTICATED`), no via nuevas `PagePermission` por rol (para no tener que acordarse de agregarlo a cada rol futuro).
- **Ask first**: cualquier cambio a que paginas ve cada rol hoy (el matrix de `PagePermission` en si) — este spec no cambia permisos, solo la landing page y el fallback de error.
- **Never**: tocar `app/gantt/page.tsx`, `app/admin/control-horas/page.tsx`, `components/gantt/*`, ni el flujo de permisos de `admin/permissions` — fuera de alcance, consistente con specs anteriores de esta sesion.

## Success Criteria

1. `cuslenghi@zircon.tech` puede loguearse y ve una pantalla de inicio valida (Dashboard), no "Acceso denegado".
2. `/dashboard` existe, es visible para todos los roles autenticados, y muestra cantidad de usuarios, cantidad de proyectos y proximos feriados.
3. `/` y la pantalla de "Acceso denegado" apuntan a `/dashboard`, no a `/gantt`.
4. El combo de proyecto en el picker de fila de Mis Horas se despliega completo, sin recortes.
5. El header y las filas de la tabla de Mis Horas quedan alineados; el boton de borrar ya no sobresale del borde de la tabla.
6. El boton de borrar fila en Mis Horas usa el tacho de basura rojo (`Trash2`), igual que en Proyectos/Feriados/Recursos.
7. `git diff --stat` confirma cero cambios en Gantt, Control de Horas y el matrix de permisos.
8. `npx tsc --noEmit` y `npm run build` pasan sin errores.

---

# Spec: Rediseno mobile de Mis Horas / Mi Reporte + borrado mensual en T&M

## Objective

Tres pedidos relacionados sobre las dos pantallas de autoservicio de horas:

1. **Mobile de Mis Horas y Mi Reporte no es amigable.** Ambas usan una grilla ancha (columnas por dia) pensada para desktop, que en mobile obliga a scrollear horizontalmente entre columnas angostas — dificil de usar para cargar o leer horas desde el celular.
2. **Mi Reporte en desktop se ve vacio con pocas filas.** Con 4-5 tareas la tabla es chica y queda mucho espacio en blanco entre el final de la tabla y el resto de la pagina; ademas, a diferencia del reporte admin (que compara muchos recursos), esta pantalla siempre muestra las horas de una sola persona, asi que el diseno "grilla densa" le queda grande.
3. **T&M no tiene forma de borrar todo el mes cargado** — hoy solo se puede sobreescribir dia por dia a mano.

## Hallazgos clave de la exploracion

- **Mis Horas (modo Detallado)**: la grilla tiene 7 columnas de dia + nombre + total + borrar, con scroll horizontal (`overflow-x-auto`) y columnas que se angostan en mobile (52px) pero siguen siendo una grilla ancha — el patron clasico de "tabla de escritorio embutida en mobile" que las guias de usabilidad mobile actuales (Nielsen Norman Group, Material Design, Apple HIG) desaconsejan: dificulta comparar "que dia es este" mientras se scrollea, y los inputs de hora quedan con un area de toque chica.
- **Mis Horas (modo T&M)**: ya usa una lista vertical (`divide-y`, un renglon por dia habil) — este modo **ya es mobile-friendly**, no necesita rediseno estructural.
- **Mi Reporte**: la tabla pivot (proyecto x dia) tiene el mismo problema de columnas angostas en mobile, agravado porque es de solo lectura — el usuario tiene que retener mentalmente "que dia es la columna 4" mientras compara valores.
- **La "gran zona en blanco" en Mi Reporte desktop no es un bug de altura forzada** — el contenedor usa `max-h-[700px]` con `overflow-auto`, que solo limita un maximo, no fuerza esa altura. Lo que realmente pasa es que la pagina no tiene mas contenido que una tabla chica: no hay ningun resumen/KPI arriba (a diferencia de `/dashboard`, que ya usa tarjetas de estadisticas), asi que con pocas filas la pagina se siente vacia. La solucion no es forzar que la tabla "llene" la pantalla, sino agregar contenido util (tarjetas de resumen) que le den sentido al espacio.
- Ya existe **prior art de borrado masivo por mes** en `app/api/time-entries/route.ts` (admin, `DELETE ?month=YYYY-MM`, borra por rango de fecha con `deleteMany`) y su UI en `app/admin/hours/page.tsx` (tarjeta con borde rojo, badge "Irreversible", `confirm()` antes de llamar). El endpoint de colaborador (`app/api/me/time-entries/route.ts`) hoy solo soporta `DELETE ?id=` (una fila). Se extiende siguiendo el mismo patron ya validado, pero acotado por `resourceId` (server-side, nunca confiar en un id que mande el cliente) + `projectId` + rango del mes.
- **Alcance del borrado**: "borrar todas las horas del mes" en T&M debe borrar solo las entradas de esa modalidad (`taskId: null`, `entryType: 'regular'`) para ese proyecto y mes — no las entradas del modo Detallado que el mismo usuario pudiera tener cargadas para el mismo proyecto en el mismo rango de fechas (son cosas distintas, aunque compartan `resourceId`+`projectId`+`date`).
- `useIsMobile()` ya existe y es el breakpoint compartido (`max-width: 767px`) usado en toda la app — se reutiliza tal cual, sin breakpoints nuevos.

## Decisiones

1. **Mis Horas, modo Detallado, mobile**: se reemplaza la grilla de 7 columnas por una vista de **un dia a la vez** (patron ya estandar en apps de time-tracking mobile como Toggl/Clockify): navegacion de semana (← →, ya existe) + selector de dia dentro de esa semana (7 pastillas Lun-Dom, resaltando el dia seleccionado/hoy), y debajo una lista vertical de tareas para ese dia — cada fila con nombre de tarea + un input de horas a ancho completo + boton de borrar con area de toque comoda. El picker "+ Agregar tarea" pasa de celda angosta a bloque apilado a ancho completo. Toda la logica de datos (query, `saveCell`, `removeRow`, `addRow`, `grid`) se reutiliza sin cambios — solo cambia el JSX que se renderiza cuando `isMobile` es true. **Desktop no cambia**, sigue siendo la grilla semanal completa.
2. **Mis Horas, modo T&M, mobile**: sin cambios estructurales (ya es una lista vertical). Se agrega ahi mismo el nuevo boton de borrado de mes (ver punto 4), con layout que se apila bien en mobile (ya usa `flex-wrap`).
3. **Mi Reporte, mobile**: se reemplaza la tabla pivot por una **lista de tarjetas por dia** (patron "historial cronologico", como el resto de las apps de reporte personal) — un dia por tarjeta, solo los dias con horas cargadas (se saltean los dias en cero para no obligar a scrollear un mes entero vacio), cada tarjeta con fecha + lista de proyecto/horas (+extra en naranja como hoy) + total del dia. Arriba de la lista, las tarjetas de resumen del punto 5 (mismas para mobile y desktop). **Desktop sigue usando la tabla pivot** (es la vista correcta para comparar muchos dias de un vistazo en una pantalla ancha) pero con el fix del punto 5.
4. **Mi Reporte, desktop**: se quita el `max-h-[700px]` fijo — la tabla pasa a ocupar su alto natural (con un tope razonable solo para rangos muy largos, `max-h-[60vh]`, que no se nota con pocas filas). Se agregan **tarjetas de resumen** arriba de la tabla (mismo lenguaje visual que las de `/dashboard`: icono en caja de color + numero grande + etiqueta): Total de horas, Promedio por dia con carga, Proyectos con horas, Dias con horas cargadas. Esto le da contenido real a la pagina en vez de forzar que una tabla chica "rellene" el espacio — soluciona la sensacion de vacio sin inventar altura artificial.
5. **T&M — borrar mes completo**: nuevo boton "Borrar mes" junto a "Guardar mes", estilo boton secundario destructivo (borde/texto rojo, no relleno — para no competir visualmente con la accion primaria de guardar), deshabilitado sin proyecto elegido. Al clickear, `confirm()` con el nombre del proyecto y el mes (mismo patron que ya usa `removeRow` en Mis Horas y el borrado por mes de `admin/hours`). Llama al DELETE extendido de `/api/me/time-entries`, invalida la query de T&M — el `useEffect` existente que siembra `tmDayValues` desde `tmEntries` ya maneja el caso "sin entradas guardadas" (vuelve a `tmDefaultHours` por dia), asi que no hace falta logica extra de limpieza en el cliente.
6. **No se toca el modo Detallado en desktop, ni Gantt, ni Control de Horas, ni ninguna pantalla de admin** — mismos limites que specs anteriores de esta sesion.
7. **Fuera de alcance (recomendacion para mas adelante, no se implementa en este spec)**: un grafico de barras de horas por dia en Mi Reporte. Ayudaria a reconocer patrones de un vistazo, pero es una pieza de UI nueva (sin libreria de charts en el stack — habria que construir un SVG a medida) que amerita su propia iteracion en vez de sumarse a este cambio ya grande. Se deja documentado como siguiente paso sugerido.

## Tech Stack

Sin cambios: Next.js 14 App Router, Prisma 5 + Turso, NextAuth 4 (JWT), TanStack Query v5, Tailwind, lucide-react, date-fns. Sin librerias nuevas — nada de chart libraries (ver punto 7 de Decisiones).

## Project Structure

```
app/
  mis-horas/page.tsx   -> vista mobile de un dia a la vez (modo Detallado); boton "Borrar mes" en T&M
  mi-reporte/page.tsx  -> tarjetas de resumen (desktop + mobile); tabla desktop sin max-height fijo; lista de tarjetas por dia en mobile
  api/me/time-entries/route.ts -> DELETE se extiende: soporta ?id= (existente, una fila) o ?projectId=&month=YYYY-MM (nuevo, borrado masivo T&M acotado a resourceId propio + taskId null)
```

## Code Style

Mismos patrones ya establecidos: `useIsMobile()` para branchear JSX por breakpoint (no CSS-only, ya que la reestructuracion mobile no es solo un reflow sino un layout distinto); tarjetas de resumen con el mismo markup que ya usa `app/dashboard/page.tsx` (icono en caja `#E6F2FA` + numero + label) para consistencia visual entre pantallas; confirmaciones destructivas con `confirm()` nativo (patron ya usado en `removeRow` y en `admin/hours`), sin modales nuevos. Ruta API: sigue `export const dynamic = 'force-dynamic'` + `NextResponse.json`, mismo `requireOwnResource()` para resolver el recurso del usuario.

## Testing Strategy

Sin suite automatizada — verificacion manual + `npx tsc --noEmit` + `npm run build`, patron ya usado en todo el repo. Casos a verificar explicitamente:
- Mis Horas mobile (viewport <768px), modo Detallado: se ve un dia a la vez, se puede cambiar de dia con las pastillas, cargar/editar/borrar horas funciona igual que en desktop.
- Mis Horas desktop: la grilla semanal de 7 columnas sigue igual que antes de este spec (sin regresiones).
- Mi Reporte mobile: lista de tarjetas por dia, sin scroll horizontal, dias en cero no aparecen.
- Mi Reporte desktop: tabla sin espacio en blanco forzado con pocas filas; tarjetas de resumen muestran numeros coherentes con la tabla.
- T&M: "Borrar mes" pide confirmacion, borra solo las entradas T&M de ese proyecto/mes (no toca entradas del modo Detallado del mismo usuario/proyecto/rango), y despues de borrar los dias vuelven a mostrar `tmDefaultHours` (comportamiento de "sin datos guardados", no ceros).
- Llamar el DELETE nuevo con un `projectId` de otro recurso (vía fetch directo) confirma que solo afecta al `resourceId` propio.
- Gantt, Control de Horas, admin: sin cambios (`git diff --stat`).

## Boundaries

- **Always**: resolver el `resourceId` del borrado masivo server-side vía `requireOwnResource()`, nunca confiar en un `resourceId` que mande el cliente; mantener el modo Detallado de escritorio sin cambios de comportamiento.
- **Ask first**: cualquier cambio al modelo de datos (`TimeEntry`, `Task`) — este spec es solo de UI/UX y un endpoint de borrado, no toca el schema.
- **Never**: tocar Gantt, Control de Horas, o pantallas `/admin/*`; agregar una libreria de charts sin acordarlo antes (ver punto 7 de Decisiones).

## Success Criteria

1. En un viewport mobile, Mis Horas (modo Detallado) muestra un dia a la vez con navegacion por pastillas, sin scroll horizontal de columnas.
2. En un viewport mobile, Mi Reporte muestra una lista de tarjetas por dia en vez de la tabla pivot, sin scroll horizontal.
3. En desktop, Mi Reporte muestra tarjetas de resumen (total, promedio, proyectos, dias con carga) y la tabla ya no deja una franja de espacio en blanco forzada cuando hay pocas filas.
4. T&M tiene un boton "Borrar mes" que, con confirmacion, elimina todas las entradas T&M (taskId null) de ese proyecto/mes para el usuario logueado, sin afectar entradas de otros proyectos, otros meses, u otros usuarios.
5. Mis Horas desktop (modo Detallado) y T&M mantienen su comportamiento actual sin regresiones.
6. Gantt, Control de Horas y las pantallas de admin quedan sin cambios (`git diff --stat` vacio).
7. `npx tsc --noEmit` y `npm run build` pasan sin errores.

---

# Spec: Fix rango de dias en Mi Reporte, tareas T&M visibles en Detallado, crear tareas desde Mis Horas, sidebar

## Objective

Cinco pedidos sobre las mismas dos pantallas de autoservicio, mas la marca en el sidebar:

1. **Mi Reporte solo muestra los dias con horas cargadas, no el rango filtrado.** Con "Desde 01/08" y "Hasta 31/08" seleccionado, la tabla solo mostro 5 columnas (17 al 21) porque esos fueron los unicos dias con datos esa semana — el resto del mes no aparece aunque este dentro del filtro.
2. **Mis Horas no deja crear tareas nuevas** — el picker de fila solo ofrece tareas que un admin ya haya cargado desde `/projects`. El usuario quiere poder agregar una tarea nueva ahi mismo.
3. **La tabla de Mis Horas se ve chica en pantallas anchas** — pedido abierto de mejora visual/UX.
4. **El nombre "ZirconTracker" se corta en el sidebar** (se ve "ZirconTrac...").
5. **Las horas cargadas en modo Time & Material no aparecen en modo Detallado.** El usuario quiere verlas y poder editarlas ahi tambien — que "sin tarea asignada" no sea motivo para ocultarlas.

## Hallazgos clave de la exploracion

- **Causa raiz del bug de Mi Reporte**: `lib/time-entries-pivot.ts` arma la lista de columnas (`days`) recorriendo las entradas encontradas y agregando cada fecha que aparece en al menos una (`daySet.add(dayKey)` dentro del loop de entries) — nunca a partir del rango pedido (`dateFrom`/`dateTo`). Si el usuario cargo horas solo 5 dias del mes, la tabla muestra exactamente esos 5 dias sin importar que el filtro diga "todo agosto". Esta funcion es compartida por `/api/me/time-entries` (Mi Reporte) y `/api/time-entries` (el pivot que usa `admin/daily-report`) — mismo bug latente ahi tambien, aunque no fue lo reportado.
- **"Agregar tareas" hoy es admin-only por diseno explicito** (`app/api/tasks/route.ts`, `POST` con `requireAdmin()`) — decision tomada en el spec original de este feature ("solo el admin puede crear/editar/borrar Task"). El pedido actual solo pide destrabar la creacion para el propio usuario, no edicion ni borrado — esas siguen siendo admin-only via `components/modals/ProjectModal.tsx` (sin cambios).
- **Por que las horas T&M no aparecen en Detallado**: `app/mis-horas/page.tsx` arma la grilla del modo Detallado con `if (e.taskId == null) continue` — descarta explicitamente cualquier entrada sin tarea. Las filas se identifican solo por `taskId` (`Map<number, ...>`), lo que ademas no alcanzaria para distinguir "sin tarea del Proyecto A" de "sin tarea del Proyecto B" si simplemente se dejara de filtrar — hace falta que la identidad de fila sea `(projectId, taskId | null)`, no solo `taskId`.
- **Por que el nombre se corta**: el header del sidebar pone logo + "ZirconTracker" en una fila (`flex items-center gap-2.5`) compartiendo ancho con el boton de colapsar/cerrar; a `w-52` (208px) menos padding, icono y boton, quedan ~100px para un texto bold de 16px — no entra. Poner el icono arriba y el nombre debajo (columna en vez de fila) le da al texto el ancho casi completo del sidebar para el mismo contenido.
- **Por que Mis Horas "se ve chica"**: la tarjeta de la tabla no tiene `w-full` — se achica al ancho de sus columnas fijas (~830px) y deja un area en blanco a la derecha en pantallas anchas, el mismo tipo de "espacio vacio" que ya se resolvio para Mi Reporte agregando contenido real (tarjetas de resumen) en el spec anterior.

## Decisiones

1. **`buildTimeEntriesPivot` arma `days` a partir del rango pedido cuando el llamador lo pasa completo** (`from` y `to` ambos definidos), generando cada dia del rango sin importar si tiene entradas o no; si el rango no viene completo (llamado sin filtro de fecha), se mantiene el comportamiento actual (dias derivados de los datos). Se actualizan **ambos** llamadores (`app/api/me/time-entries/route.ts` y `app/api/time-entries/route.ts`) para pasar su `from`/`to` ya calculado — arregla Mi Reporte y de paso el mismo bug latente en `admin/daily-report`, sin tocar ninguna pantalla de admin (el fix vive en la libreria compartida + una linea en la ruta API).
2. **Creacion de tareas desde Mis Horas**: en el picker de fila, el `<select>` de tarea suma una opcion "+ Crear tarea nueva..." que revela un input de texto + boton confirmar; al confirmar, `POST /api/tasks` con `{projectId, name}` y la tarea recien creada queda seleccionada. Se relaja el auth de `POST /api/tasks` de `requireAdmin()` a un nuevo helper `requireAdminOrOwnResource()` en `lib/auth.ts` (admin, o cualquier usuario con `Resource` propio vinculado por email) — mismo patron ya usado por `requireSelfOrAdmin`/`requireOwnResource`. PUT/DELETE de tareas siguen siendo admin-only (sin cambios) — este pedido es solo "agregar", no editar ni borrar.
3. **Mis Horas desktop, mas contenido util**: la tarjeta de la tabla pasa a `w-full`; se agregan tarjetas de resumen arriba (mismo lenguaje visual que Mi Reporte/Dashboard) — Total semana, Proyectos, Tareas activas. Con el punto 5 (T&M visible en Detallado) la tabla tambien va a tener naturalmente mas filas para quien usa ambos modos, lo que ayuda a la misma sensacion de "tabla chica".
4. **Sidebar**: el bloque de marca pasa de fila a columna (icono arriba, nombre debajo, ambos centrados) cuando `showLabels` es true; el boton de colapsar/cerrar se reposiciona como elemento independiente (esquina superior derecha) en vez de compartir la fila con el logo. En estado colapsado (desktop, icono-only) el comportamiento no cambia: sigue sin mostrar logo ni nombre, solo el boton de expandir (tal cual hoy).
5. **T&M visible y editable en Detallado**: se generaliza la identidad de fila de `taskId: number` a un par `(projectId, taskId | null)` — clave compuesta `"${projectId}:${taskId ?? 'none'}"`. Se deja de filtrar las entradas con `taskId == null` al armar la grilla; una fila sin tarea se etiqueta `"<Proyecto>: Sin tarea (T&M)"` y es editable celda por celda igual que cualquier otra fila (mismo `PUT` de siempre, que ya acepta `taskId: null`). El picker de fila suma una opcion "Sin tarea (Time & Material)" en el `<select>` de tarea para poder agregar una fila asi manualmente tambien desde Detallado. Edita los mismos registros que ve T&M (misma tabla `TimeEntry`), asi que cambios hechos desde una pestana se reflejan en la otra al volver a visitarla (TanStack Query ya refetchea al re-habilitarse la query, sin necesidad de invalidacion cruzada extra).
6. **No se toca Gantt, Control de Horas, ni ninguna pantalla `/admin/*`** — mismos limites que specs anteriores. El fix de `time-entries-pivot.ts` es una libreria compartida, no una pantalla; no implica cambios visibles en `admin/daily-report`.

## Tech Stack

Sin cambios: Next.js 14 App Router, Prisma 5 + Turso, NextAuth 4 (JWT), TanStack Query v5, Tailwind, lucide-react, date-fns. Sin librerias nuevas.

## Project Structure

```
lib/time-entries-pivot.ts        -> buildTimeEntriesPivot acepta un rango opcional {from, to} para generar `days`
lib/auth.ts                      -> + requireAdminOrOwnResource()
app/api/tasks/route.ts           -> POST usa requireAdminOrOwnResource() en vez de requireAdmin()
app/api/me/time-entries/route.ts -> pasa {from, to} a buildTimeEntriesPivot
app/api/time-entries/route.ts    -> pasa {from, to} a buildTimeEntriesPivot (mismo fix para admin/daily-report)
app/mis-horas/page.tsx           -> filas por (projectId, taskId|null); crear tarea inline; tarjetas de resumen; card w-full
components/layout/Sidebar.tsx    -> bloque de marca en columna (icono arriba, nombre debajo)
```

## Code Style

Mismos patrones ya establecidos: helpers de autorizacion en `lib/auth.ts` siguiendo el estilo de `requireSelfOrAdmin`/`requireOwnResource` (resuelven el `Resource` propio por email de sesion, nunca confian en un id que mande el cliente); tarjetas de resumen con el mismo markup que ya usan Mi Reporte/Dashboard; claves compuestas de fila como string simple (`"${projectId}:${taskId ?? 'none'}"`) con un par de funciones `rowKey`/`parseRowKey`, sin introducir un tipo/clase nueva para algo tan chico.

## Testing Strategy

Sin suite automatizada — verificacion manual + `npx tsc --noEmit` + `npm run build`. Casos a verificar explicitamente:
- Mi Reporte con el mes completo seleccionado y horas cargadas solo en 5 dias: la tabla muestra las 30/31 columnas del mes, con los dias sin carga en blanco (no ocultos).
- Mi Reporte con un rango de dias mas acotado (ej. una semana): muestra exactamente esos dias, ni mas ni menos.
- Mis Horas: crear una tarea nueva desde el picker de fila, confirmar que aparece disponible para seleccionar y que la fila se puede cargar con horas normalmente.
- Un usuario sin rol admin ni `Resource` vinculado que intente `POST /api/tasks` recibe 403.
- Mis Horas Detallado: una entrada cargada desde T&M (sin tarea) aparece como fila "Proyecto: Sin tarea (T&M)", editable celda por celda; el cambio se refleja si se vuelve a visitar la pestana T&M para ese proyecto/mes.
- Agregar una fila "Sin tarea (Time & Material)" manualmente desde el picker de Detallado y cargarle horas — se guarda igual que cualquier entrada T&M.
- Sidebar expandido: "ZirconTracker" se ve completo, sin truncar, con el icono arriba. Sidebar colapsado (desktop): comportamiento sin cambios (solo boton de expandir).
- Gantt, Control de Horas, admin: sin cambios (`git diff --stat`).

## Boundaries

- **Always**: resolver el `Resource` propio server-side por email de sesion para el nuevo helper de autorizacion, nunca confiar en datos que mande el cliente; mantener PUT/DELETE de tareas admin-only.
- **Ask first**: cualquier cambio al limite de cuantas tareas puede crear un colaborador, o a permitirles editar/borrar tareas (este spec es solo "crear").
- **Never**: tocar Gantt, Control de Horas, o pantallas `/admin/*`; agregar validacion de duplicados a nivel de base de datos para `Task.name` (fuera de alcance — un chequeo simple del lado cliente alcanza).

## Success Criteria

1. Mi Reporte muestra todos los dias del rango filtrado (por defecto el mes completo), no solo los dias con horas cargadas.
2. Se puede crear una tarea nueva desde el picker de fila de Mis Horas sin pasar por `/projects`.
3. Mis Horas desktop tiene tarjetas de resumen y la tabla ocupa el ancho completo de la tarjeta contenedora.
4. "ZirconTracker" se lee completo en el sidebar expandido.
5. Las entradas cargadas en modo T&M (sin tarea) son visibles y editables desde el modo Detallado, y se puede agregar una fila "sin tarea" manualmente ahi tambien.
6. Gantt, Control de Horas y pantallas de admin quedan sin cambios (`git diff --stat` vacio salvo `lib/time-entries-pivot.ts` y `app/api/time-entries/route.ts`, que son fix de libreria compartida, no UI).
7. `npx tsc --noEmit` y `npm run build` pasan sin errores.
