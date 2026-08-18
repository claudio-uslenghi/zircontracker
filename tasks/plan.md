# Implementation Plan: Tareas + Carga de Horas Self-Service + Rol Colaborador

Spec de referencia: [`SPEC.md`](../SPEC.md)

## Overview

Habilitar carga de horas self-service (matriz semanal por tarea + bulk mensual T&M) para un nuevo rol "colaborador", con acceso acotado a un puñado de pantallas. Se construye en 5 fases verticales: primero la base de datos y el permisos (sin la cual nada del resto es seguro), luego el lado admin (tareas + hardening de escrituras existentes), luego la API self-service, luego la UI self-service, y por último las restricciones de UI en pantallas existentes + perfil.

## Architecture Decisions

- **El sistema de `PagePermission` existe pero no está conectado.** `checkPagePermission()` (`lib/auth.ts`) no se llama desde ningún lado — ni `middleware.ts` (que solo protege `/admin/*`) ni `Sidebar.tsx` (que muestra `NAV_ITEMS` fijo a todo usuario logueado). Antes de poder decir "colaborador ve X pero no Y", hay que cablear esto por primera vez. Se resuelve embebiendo `allowedPages: string[]` en el JWT al login (mismo patrón que ya usa `roles`), para que `middleware.ts` pueda filtrar por prefijo de ruta sin pegarle a la DB en cada request (Prisma+Turso en Edge middleware sería lento/arriesgado). El costo: el listado de páginas permitidas no se actualiza hasta el próximo login — mismo comportamiento que ya tiene `roles` hoy, así que es consistente con el resto de la app.
- **`/perfil` es la única página "universal"**: cualquier usuario autenticado entra, sin pasar por `PagePermission`. Se maneja como una excepción explícita en middleware, igual que hoy existe la lista `PUBLIC_PATHS`.
- **La seguridad real vive en las rutas API, no en la UI.** Ocultar botones en `/projects` y `/holidays` es UX; el límite de verdad son `requireAdmin()` / `requireSelfOrAdmin()` en cada handler. Se corrigen dos rutas que hoy no tienen ningún check: `PUT/DELETE /api/projects/[id]` y `POST /api/vacations` + `DELETE /api/vacations/[id]`.
- **Reutilizar `TimeEntry` tal cual**, solo se le agrega `taskId` opcional. La lógica de agregación pivot ya existente en `app/api/time-entries/route.ts` se extrae a una función compartida para no duplicarla en la nueva ruta `/api/me/time-entries?view=pivot` que alimenta `/mi-reporte`.
- **T&M y NULL en SQLite**: el unique index de `TimeEntry` no deduplica filas con `taskId = null` (SQLite trata cada NULL como distinto). El endpoint de bulk T&M hace "buscar por resourceId+projectId+date+entryType+taskId IS NULL → actualizar si existe, si no insertar" en vez de confiar en `ON CONFLICT`.

## Task List

### Phase 1: Foundation — schema, migración, permisos reales

- [ ] **Task 1: Prisma schema + script de migración**
  - **Description:** Agregar `Resource.email` (String?, unique), modelo `Task`, `TimeEntry.taskId` (Int?, FK a Task) y actualizar el unique index a `[resourceId, projectId, date, entryType, taskId]`. Crear `scripts/add-task-and-email.ts` siguiendo el patrón idempotente de `scripts/add-entry-type.ts` (ALTER TABLE con catch de "duplicate column", DROP/CREATE del índice único).
  - **Acceptance criteria:**
    - [ ] `npx prisma generate` corre sin errores con el nuevo schema
    - [ ] El script de migración corre dos veces seguidas sin fallar (idempotente)
  - **Verification:** `npx tsc --noEmit`; correr el script contra Turso y confirmar con una query manual (`SELECT * FROM pragma_table_info('TimeEntry')`) que `taskId` existe.
  - **Dependencies:** None
  - **Files:** `prisma/schema.prisma`, `scripts/add-task-and-email.ts`
  - **Scope:** S

- [ ] **Task 2: Ejecutar migración contra Turso**
  - **Description:** Correr el script del Task 1 contra la base real (no hay entorno de staging separado — usar horario de bajo uso, avisar antes de correr).
  - **Acceptance criteria:**
    - [ ] Columna `email` en `Resource`, tabla `Task`, columna `taskId` en `TimeEntry`, índice único nuevo — todo presente en Turso
    - [ ] Datos existentes de `TimeEntry`/`Resource` intactos (conteo de filas antes/después igual)
  - **Verification:** Query manual post-migración; `npm run build` deploya sin el error de tipo que ya vimos una vez con `entryType`.
  - **Dependencies:** Task 1
  - **Files:** ninguno (operación, no código)
  - **Scope:** XS — **requiere confirmación explícita antes de correr en producción** (boundary del spec)

- [ ] **Task 3: Tipos + helper `requireSelfOrAdmin`**
  - **Description:** Agregar `Task` y actualizar `TimeEntry` en `types/index.ts`. Agregar `requireSelfOrAdmin(resourceId)` a `lib/auth.ts` (resuelve `session.user.email` → `Resource`, permite si es admin o si el `resourceId` coincide).
  - **Acceptance criteria:**
    - [ ] `requireSelfOrAdmin` lanza `Forbidden` si el email de sesión no matchea ningún `Resource`, o si matchea uno distinto al `resourceId` pedido
    - [ ] Admin siempre pasa, sin necesidad de tener `Resource` vinculado
  - **Verification:** `npx tsc --noEmit`
  - **Dependencies:** Task 1
  - **Files:** `types/index.ts`, `lib/auth.ts`
  - **Scope:** S

- [ ] **Task 4: Cablear enforcement real de páginas (el hallazgo del gap)**
  - **Description:** En `lib/auth-options.ts`, en el callback `jwt`, calcular y embeber `token.allowedPages` (query a `pagePermission` para los roles del usuario) además de `roles`. En `session` callback, copiarlo a `session.user.allowedPages`. En `middleware.ts`, para rutas no públicas y no-admin, si el usuario no es admin, redirigir a `/unauthorized` cuando el pathname no matchea ningún prefijo de `allowedPages` — excepto `/perfil`, que se agrega a una nueva lista de rutas "autenticado-pero-sin-restricción" junto a `PUBLIC_PATHS`. En `Sidebar.tsx`, reemplazar el `NAV_ITEMS` fijo por un filtro contra `session.user.allowedPages` (admin sigue viendo todo). Agregar `/mis-horas` y `/mi-reporte` a `ALL_PAGES` en `app/api/admin/permissions/route.ts` para que el admin pueda asignarlas desde la matriz existente.
  - **Acceptance criteria:**
    - [ ] Un usuario con un rol sin ningún `PagePermission` asignado no ve ítems de nav (salvo `/perfil` si se agrega ahí) y es redirigido a `/unauthorized` si entra por URL directa
    - [ ] Admin no pierde acceso a nada (regression check)
    - [ ] Roles ya existentes en producción (`planner`, `viewer`, si tienen usuarios reales) se auditan antes de activar esto — **avisar al usuario si hay usuarios no-admin activos hoy**, porque van a pasar de "ven todo" a "ven según su matriz de permisos" de un día para el otro
  - **Verification:** Login manual con un usuario de rol no-admin de prueba, antes y después de asignarle permisos desde `/admin/permissions`; `npx tsc --noEmit`.
  - **Dependencies:** Task 3
  - **Files:** `lib/auth-options.ts`, `middleware.ts`, `components/layout/Sidebar.tsx`, `app/api/admin/permissions/route.ts`
  - **Scope:** M

### Checkpoint: Foundation
- [ ] `npx tsc --noEmit` limpio
- [ ] Login de admin funciona igual que antes (sin regresiones)
- [ ] Un rol de prueba sin permisos queda efectivamente bloqueado de páginas no listadas
- [ ] Revisar con el usuario antes de seguir: ¿hay usuarios no-admin reales hoy que se van a ver afectados por el Task 4?

### Phase 2: Lado admin — Tareas + hardening de escrituras

- [ ] **Task 5: API `/api/tasks`**
  - **Description:** `GET /api/tasks?projectId=` (cualquier usuario autenticado — lo necesita la UI self-service para poblar el picker de tareas), `POST /api/tasks` (admin, crea tarea en un proyecto), `PUT/DELETE /api/tasks/[id]` (admin).
  - **Acceptance criteria:**
    - [ ] POST/PUT/DELETE devuelven 403 si no es admin
    - [ ] GET funciona para cualquier sesión válida
  - **Verification:** `npx tsc --noEmit`; probar con curl/fetch los 4 verbos con y sin sesión admin.
  - **Dependencies:** Task 1
  - **Files:** `app/api/tasks/route.ts`, `app/api/tasks/[id]/route.ts`
  - **Scope:** S

- [ ] **Task 6: UI admin para gestionar tareas por proyecto**
  - **Description:** Agregar una sección "Tareas" dentro de `components/modals/ProjectModal.tsx` (listar/crear/editar/desactivar tareas del proyecto que se está editando) — evita crear una pantalla admin nueva, reutiliza el modal existente.
  - **Acceptance criteria:**
    - [ ] Desde el modal de edición de un proyecto, el admin puede agregar una tarea, verla en la lista, marcarla inactiva
  - **Verification:** Manual en navegador.
  - **Dependencies:** Task 5
  - **Files:** `components/modals/ProjectModal.tsx`
  - **Scope:** M

- [ ] **Task 7: Hardening `/api/projects/[id]`**
  - **Description:** Agregar `requireAdmin()` a `PUT` y `DELETE` en `app/api/projects/[id]/route.ts` (hoy no tienen ningún check).
  - **Acceptance criteria:**
    - [ ] `PUT`/`DELETE` devuelven 403 sin sesión admin
  - **Verification:** curl/fetch directo con sesión no-admin → 403.
  - **Dependencies:** Task 3
  - **Files:** `app/api/projects/[id]/route.ts`
  - **Scope:** XS

- [ ] **Task 8: Hardening + self-service de `/api/vacations`**
  - **Description:** `POST /api/vacations` y `DELETE /api/vacations/[id]` hoy no tienen ningún check — se les agrega `requireSelfOrAdmin(resourceId)`. El admin puede seguir creando/borrando vacaciones de cualquier recurso; un colaborador solo de las propias (el `resourceId` para colaborador se resuelve server-side vía `/api/me/resource`, nunca se confía en el que mande el body).
  - **Acceptance criteria:**
    - [ ] Colaborador puede crear/borrar sus propias vacaciones
    - [ ] Colaborador recibe 403 si intenta crear/borrar una vacación de otro `resourceId`
    - [ ] Admin sigue pudiendo operar sobre cualquier recurso
  - **Verification:** curl/fetch con dos usuarios de prueba (colaborador A intentando tocar el resourceId de colaborador B).
  - **Dependencies:** Task 3
  - **Files:** `app/api/vacations/route.ts`, `app/api/vacations/[id]/route.ts`
  - **Scope:** S

### Checkpoint: Lado admin
- [ ] Admin puede crear tareas en un proyecto desde la UI
- [ ] Las 3 rutas de escritura previamente desprotegidas ahora exigen el rol/ownership correcto, verificado con llamadas directas (no solo desde la UI)
- [ ] `npx tsc --noEmit` limpio

### Phase 3: API self-service de carga de horas

- [ ] **Task 9: `/api/me/resource`**
  - **Description:** `GET /api/me/resource` — resuelve `session.user.email` → `Resource`, devuelve 404 con mensaje claro si no hay match (para que el admin sepa que falta vincular el email).
  - **Acceptance criteria:**
    - [ ] Devuelve el `Resource` correcto para un usuario vinculado
    - [ ] 404 legible si no hay `Resource.email` que matchee
  - **Verification:** curl/fetch con usuario vinculado y sin vincular.
  - **Dependencies:** Task 1
  - **Files:** `app/api/me/resource/route.ts`
  - **Scope:** XS

- [ ] **Task 10: `/api/me/time-entries` GET**
  - **Description:** Devuelve las entradas propias (resourceId resuelto server-side) para un rango de fechas (semana o mes, según query param), agrupadas por proyecto/tarea — reutilizable tanto por la grilla semanal como por `/mi-reporte`. Extraer la lógica de pivot ya existente en `app/api/time-entries/route.ts` (view=pivot) a un helper compartido en `lib/time-entries-pivot.ts` para no duplicarla.
  - **Acceptance criteria:**
    - [ ] Solo devuelve datos del `resourceId` propio, nunca de otros
    - [ ] Soporta `view=pivot` para alimentar `/mi-reporte`
  - **Verification:** `npx tsc --noEmit`; comparar output contra lo que hoy arma `admin/daily-report` filtrado manualmente por ese resourceId.
  - **Dependencies:** Task 9
  - **Files:** `app/api/me/time-entries/route.ts`, `lib/time-entries-pivot.ts` (nuevo, extraído de `app/api/time-entries/route.ts`)
  - **Scope:** M

- [ ] **Task 11: `/api/me/time-entries` PUT (modo detallado, upsert por celda)**
  - **Description:** Upsert de una celda de la grilla: `{ projectId, taskId, date, hours, entryType }` → crea o actualiza la fila `(resourceId propio, projectId, taskId, date, entryType)`.
  - **Acceptance criteria:**
    - [ ] Guardar 3h en Tarea A y 2h en Tarea B el mismo día/proyecto crea dos filas, no colisionan
    - [ ] `hours = 0` borra la entrada (o la deja en 0 — decidir en la implementación, documentar la elección)
  - **Verification:** curl/fetch con dos tareas el mismo día, confirmar 2 filas en DB.
  - **Dependencies:** Task 9
  - **Files:** `app/api/me/time-entries/route.ts`
  - **Scope:** S

- [ ] **Task 12: `/api/me/time-entries` POST bulk (modo T&M)**
  - **Description:** Recibe `{ projectId, year, month, defaultHours, overrides: { [day]: hours } }`, genera una fila por día hábil (Lun-Vie) del mes con `taskId = null`, aplicando `defaultHours` salvo que haya override para ese día. Usa "buscar por (resourceId, projectId, date, entryType, taskId IS NULL) → update si existe, insert si no" (no confía en `ON CONFLICT` porque NULL no dedupe en SQLite).
  - **Acceptance criteria:**
    - [ ] Fines de semana no generan filas
    - [ ] Días con override usan ese valor en vez del default
    - [ ] Correr el mismo bulk dos veces no duplica filas (actualiza en vez de insertar de nuevo)
  - **Verification:** curl/fetch, correr dos veces seguidas, contar filas.
  - **Dependencies:** Task 9
  - **Files:** `app/api/me/time-entries/route.ts`
  - **Scope:** M

- [ ] **Task 13: `/api/me/time-entries` DELETE**
  - **Description:** Borra una entrada propia por `id`, verificando ownership antes de borrar.
  - **Acceptance criteria:**
    - [ ] 403 si el `id` pertenece a otro `resourceId`
  - **Verification:** curl/fetch cruzado entre dos usuarios de prueba.
  - **Dependencies:** Task 9
  - **Files:** `app/api/me/time-entries/route.ts`
  - **Scope:** XS

### Checkpoint: API self-service
- [ ] Ciclo completo GET/PUT/POST-bulk/DELETE probado con curl/fetch contra una sesión de colaborador de prueba
- [ ] Todos los intentos de tocar un `resourceId` ajeno devuelven 403
- [ ] `npx tsc --noEmit` limpio

### Phase 4: UI self-service

- [ ] **Task 14: `/mis-horas` — grilla semanal (modo detallado)**
  - **Description:** Selector de proyecto + semana. Al elegir proyecto, `GET /api/tasks?projectId=` puebla las filas disponibles para agregar. Grilla: filas = tareas agregadas, columnas = Lun-Dom, celdas = input numérico que dispara `PUT /api/me/time-entries` on blur (mismo lenguaje visual que `admin/daily-report`: sticky headers, celdas fijas). Fila de total por día, columna de total por tarea/semana.
  - **Acceptance criteria:**
    - [ ] Cargar horas en 2 tareas el mismo día se refleja en ambas celdas y en el total del día
    - [ ] Sin popups — todo inline
  - **Verification:** Manual en navegador con usuario colaborador de prueba.
  - **Dependencies:** Task 11
  - **Files:** `app/mis-horas/page.tsx`
  - **Scope:** M

- [ ] **Task 15: `/mis-horas` — modo T&M bulk**
  - **Description:** Toggle dentro de la misma página. Selector de proyecto + mes, input de "horas por defecto en días hábiles" (8 o 9 u otro valor), grilla de solo lectura/edición puntual para overrides día por día, botón "Guardar mes" → `POST /api/me/time-entries` bulk.
  - **Acceptance criteria:**
    - [ ] Autocompleta 8h en días hábiles, salta fines de semana
    - [ ] Permite editar un día puntual antes de guardar
  - **Verification:** Manual en navegador.
  - **Dependencies:** Task 12
  - **Files:** `app/mis-horas/page.tsx`
  - **Scope:** M

- [ ] **Task 16: `/mi-reporte`**
  - **Description:** Adaptar el patrón visual de `app/admin/daily-report/page.tsx` (tabla pivot) pero sin filtro de recurso (siempre el propio) y sin acceso a datos de otros — consume `GET /api/me/time-entries?view=pivot`.
  - **Acceptance criteria:**
    - [ ] Muestra únicamente las horas del usuario logueado
    - [ ] Totales coinciden con lo cargado en Task 14/15
  - **Verification:** Manual en navegador.
  - **Dependencies:** Task 10
  - **Files:** `app/mi-reporte/page.tsx`
  - **Scope:** S

### Checkpoint: UI self-service
- [ ] Flujo completo end-to-end en navegador: colaborador de prueba carga horas detalladas + T&M, las ve reflejadas en su propio reporte
- [ ] `npx tsc --noEmit` limpio; `npm run build` sin errores

### Phase 5: Restricciones de UI existente + perfil

- [ ] **Task 17: `/projects` solo lectura para no-admin**
  - **Description:** Ocultar botones "Nuevo proyecto", editar (Pencil), eliminar (Trash2) cuando `!roles.includes('admin')`.
  - **Acceptance criteria:**
    - [ ] Colaborador ve la tabla completa, sin controles de escritura
  - **Verification:** Manual en navegador.
  - **Dependencies:** Task 7 (para que la restricción de UI no sea solo cosmética)
  - **Files:** `app/projects/page.tsx`
  - **Scope:** S

- [ ] **Task 18: `/holidays` — feriados solo lectura, vacaciones propias**
  - **Description:** Ocultar "Agregar feriado" para no-admin. Agregar control para que el colaborador cargue/borre sus propias vacaciones (usa `/api/me/resource` para resolver su `resourceId`, llama a `/api/vacations` ya hardeneado del Task 8).
  - **Acceptance criteria:**
    - [ ] Colaborador no ve botón de feriados
    - [ ] Colaborador puede cargar y borrar sus propias vacaciones, no las de otros
  - **Verification:** Manual en navegador.
  - **Dependencies:** Task 8, Task 9
  - **Files:** `app/holidays/page.tsx`
  - **Scope:** M

- [ ] **Task 19: `/perfil` + cambio de contraseña**
  - **Description:** Página nueva con formulario (contraseña actual, nueva, confirmar). `PATCH /api/me/password` verifica la actual con `bcrypt.compare` y hashea la nueva con `bcrypt.hash(..., 10)` (mismo patrón que `app/api/admin/users/route.ts`).
  - **Acceptance criteria:**
    - [ ] Rechaza si la contraseña actual no matchea
    - [ ] Usuario puede loguearse de nuevo con la nueva contraseña
    - [ ] Accesible para cualquier usuario autenticado, no solo colaboradores
  - **Verification:** Manual: cambiar contraseña, cerrar sesión, loguear con la nueva.
  - **Dependencies:** Task 4 (para que `/perfil` esté en la lista de excepción del middleware)
  - **Files:** `app/perfil/page.tsx`, `app/api/me/password/route.ts`
  - **Scope:** S

- [ ] **Task 20: Crear rol "colaborador" + permisos en datos reales**
  - **Description:** Vía las UIs admin ya existentes (`/admin/roles`, `/admin/permissions`): crear el rol, asignarle `/projects`, `/holidays`, `/mis-horas`, `/mi-reporte`. Vincular al menos un `Resource.email` de prueba y crear/editar un `User` de prueba con ese rol.
  - **Acceptance criteria:**
    - [ ] Recorrer los 10 puntos de "Success Criteria" del `SPEC.md` con este usuario de prueba
  - **Verification:** Checklist completo del spec.
  - **Dependencies:** Todo lo anterior
  - **Files:** ninguno (datos, no código) — **requiere confirmación explícita antes de crear en producción** (boundary del spec)
  - **Scope:** XS

### Checkpoint: Completo
- [ ] Los 10 criterios de éxito del `SPEC.md` verificados con un usuario colaborador real de prueba
- [ ] `npx tsc --noEmit` y `npm run build` limpios
- [ ] Flujos de admin existentes (import Clockify/SCC/CSV, control-horas, daily-report) sin regresiones

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| El middleware nunca filtró páginas por rol — activarlo (Task 4) puede sacarle acceso a usuarios no-admin que hoy dependen de ver esas pantallas sin querer haberlo diseñado así | Alto | Auditar `admin/users`/`admin/roles` antes de mergear el Task 4; avisar al usuario si hay roles no-admin con usuarios activos hoy |
| SQLite/Turso no dedupe `taskId = NULL` en el unique index | Medio | Lógica de "buscar y actualizar" en el endpoint bulk T&M (Task 12), no depender del `ON CONFLICT` |
| Migración de schema corre contra Turso de producción sin entorno de staging | Alto | Confirmar explícitamente con el usuario antes del Task 2 (ya es un boundary del spec); script idempotente y con el mismo patrón ya probado en `add-entry-type.ts` |
| Duplicar la lógica de pivot entre `/api/time-entries` y `/api/me/time-entries` | Bajo/Medio (mantenibilidad) | Extraer a `lib/time-entries-pivot.ts` compartido (Task 10) |

## Open Questions

- Campos de `Task` más allá de `name`/`active` — se implementa mínimo viable (ya señalado en el spec).
- ¿El picker de tareas en `/mis-horas` debe excluir tareas `active: false`? (asumir que sí, es el comportamiento obvio; confirmar si surge algo distinto durante el Task 6/14)

## Parallelization Notes

- Fase 1 es estrictamente secuencial (todo depende del schema y del cableado de permisos).
- Dentro de Fase 2, Task 5+6 (tareas) y Task 7+8 (hardening) son independientes entre sí — se pueden hacer en paralelo si hay dos sesiones disponibles.
- Fase 3 (Tasks 9-13) es mayormente secuencial dentro de la misma ruta (`/api/me/time-entries`), pero Task 9 puede ir en paralelo con el resto de Fase 2.
- Fase 4 depende de que Fase 3 esté terminada (necesita los endpoints reales, no mocks).
- Fase 5 puede arrancar en paralelo con Fase 4 en las partes que no dependen de ella (Task 19 depende solo de Task 4; Task 17 depende solo de Task 7).
