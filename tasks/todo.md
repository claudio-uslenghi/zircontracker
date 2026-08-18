# Todo: Tareas + Carga de Horas Self-Service + Rol Colaborador

Plan completo con detalle por tarea en [`plan.md`](./plan.md). Spec en [`../SPEC.md`](../SPEC.md).

## Fase 1 — Foundation (schema, migración, permisos reales)
- [ ] Task 1: Prisma schema + script de migración (`Resource.email`, `Task`, `TimeEntry.taskId`)
- [ ] Task 2: Ejecutar migración contra Turso ⚠️ requiere confirmación antes de correr
- [ ] Task 3: Tipos + helper `requireSelfOrAdmin`
- [ ] Task 4: Cablear enforcement real de páginas (middleware + Sidebar + JWT `allowedPages`) ⚠️ auditar usuarios no-admin existentes antes de activar
- [ ] **Checkpoint Fase 1**: `tsc` limpio, login admin sin regresión, rol de prueba sin permisos queda bloqueado

## Fase 2 — Lado admin (Tareas + hardening)
- [ ] Task 5: API `/api/tasks` (GET abierto, POST/PUT/DELETE admin)
- [ ] Task 6: UI de tareas dentro de `ProjectModal.tsx`
- [ ] Task 7: Hardening `PUT/DELETE /api/projects/[id]`
- [ ] Task 8: Hardening + self-service `/api/vacations` (+`[id]`)
- [ ] **Checkpoint Fase 2**: admin crea tareas desde la UI; las 3 rutas antes desprotegidas exigen rol/ownership correcto

## Fase 3 — API self-service de horas
- [ ] Task 9: `/api/me/resource`
- [ ] Task 10: `/api/me/time-entries` GET (+ `lib/time-entries-pivot.ts` compartido)
- [ ] Task 11: `/api/me/time-entries` PUT (upsert celda, modo detallado)
- [ ] Task 12: `/api/me/time-entries` POST bulk (modo T&M)
- [ ] Task 13: `/api/me/time-entries` DELETE
- [ ] **Checkpoint Fase 3**: ciclo CRUD completo probado con curl/fetch; cross-resourceId siempre 403

## Fase 4 — UI self-service
- [ ] Task 14: `/mis-horas` grilla semanal (modo detallado, sin popups)
- [ ] Task 15: `/mis-horas` modo T&M bulk
- [ ] Task 16: `/mi-reporte`
- [ ] **Checkpoint Fase 4**: flujo end-to-end en navegador con usuario colaborador de prueba

## Fase 5 — Restricciones UI existente + perfil
- [ ] Task 17: `/projects` solo lectura para no-admin
- [ ] Task 18: `/holidays` — feriados solo lectura, vacaciones propias
- [ ] Task 19: `/perfil` + `/api/me/password`
- [ ] Task 20: Crear rol "colaborador" + permisos en datos reales ⚠️ requiere confirmación antes de crear en producción
- [ ] **Checkpoint final**: los 10 criterios de éxito del `SPEC.md` verificados; `tsc` + `build` limpios; sin regresiones en flujos de admin
