<p align="center">
  <img src="public/icon.jpg" alt="ZirconTech" width="96" />
</p>

<h1 align="center">ZirconTracker</h1>

<p align="center">
  Planificación de proyectos, carga de horas y control de facturación para ZirconTech.
</p>

---

## Qué es

ZirconTracker es la herramienta interna de ZirconTech para programar proyectos y recursos, cargar horas trabajadas (por el equipo administrativo y por cada colaborador), y controlar qué se factura contra el presupuesto de cada proyecto.

La mayoría de los usuarios la van a usar para **cargar sus horas y vacaciones, y ver en qué proyectos/tareas están asignados**. El equipo de administración además gestiona el Gantt completo, los recursos, la facturación y los permisos.

## Funcionalidades

### Para cualquier colaborador
- **Mis Horas** — carga de horas propia, de dos formas:
  - *Detallado*: grilla semanal por tarea (varias tareas el mismo día, sin popups).
  - *Time & Material*: carga mensual en bloque con horas por defecto en días hábiles (salta fines de semana automáticamente).
- **Mi Reporte** — vista pivot de las horas propias por proyecto y día.
- **Proyectos** — listado de proyectos (solo lectura).
- **Feriados & Vacaciones** — calendario de feriados por país (solo lectura) y carga de las propias vacaciones.
- **Mi Perfil** — cambio de contraseña.

### Para administradores
- **Gantt** — programación de proyectos y asignación de recursos.
- **Recursos** — alta y edición de personas: país, capacidad horaria, color, email (para vincular con su usuario de login y habilitar el self-service).
- **Proyectos** — alta/edición completa, tarifas por recurso, presupuesto de horas facturables, y gestión de tareas por proyecto.
- **Feriados & Vacaciones** — carga de feriados por país (individual o por CSV) y gestión de vacaciones de cualquier recurso.
- **Reporte de Horas** — importación masiva de horas desde Clockify (CSV), Excel de SCC Time Report, o CSV legado; eliminación de horas por mes; vista tabular, resumen y gráficos.
- **Reporte Diario** — vista pivot de horas por recurso/proyecto/día, con exportación a CSV.
- **Control de Horas** — horas brutas vs. facturables por proyecto contra su presupuesto, desglose por recurso/perfil/tarifa, soporta proyectos de Precio Fijo y Time & Materials.
- **Usuarios, Roles y Permisos** — administración de cuentas, roles personalizados, y una matriz de qué rol puede ver qué página.

## Stack técnico

- [Next.js 14](https://nextjs.org) (App Router) + TypeScript
- [Prisma 5](https://www.prisma.io) + [Turso](https://turso.tech) (libSQL) como base de datos
- [NextAuth 4](https://next-auth.js.org) (credenciales + JWT) para autenticación
- [TanStack Query v5](https://tanstack.com/query) para el estado del cliente
- [Tailwind CSS](https://tailwindcss.com) para estilos
- Deploy en [Vercel](https://vercel.com)

## Desarrollo local

```bash
npm install
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000). Necesitás un `.env.local` con `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` y `NEXTAUTH_SECRET` (ver `.env` para el resto de las variables usadas).

```bash
npm run build   # build de producción
npm run lint    # eslint
npx tsc --noEmit  # chequeo de tipos
```

## Migraciones de base de datos

El schema vive en `prisma/schema.prisma`. Como Turso/libSQL no soporta `prisma migrate` de forma nativa, los cambios de schema se aplican con scripts puntuales en `scripts/` (ver los archivos `add-*.ts` como referencia) — cada uno es idempotente y se corre una sola vez contra la base de producción.

## Estructura del proyecto

```
app/                 → páginas y rutas de API (Next.js App Router)
  admin/              → pantallas solo para administradores
  api/                → rutas de API
  mis-horas/          → carga de horas self-service
  mi-reporte/          → reporte propio de horas
components/          → componentes de UI compartidos y modales
lib/                  → helpers de auth, Prisma client, utilidades
prisma/               → schema de base de datos
scripts/              → scripts de migración y setup puntuales
types/                → tipos compartidos de TypeScript
```
