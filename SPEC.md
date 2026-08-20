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
