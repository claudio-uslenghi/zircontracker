import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const ALL_PAGES = [
  { path: '/gantt', label: 'Gantt' },
  { path: '/projects', label: 'Proyectos' },
  { path: '/resources', label: 'Recursos' },
  { path: '/holidays', label: 'Feriados' },
  { path: '/mis-horas', label: 'Mis Horas' },
  { path: '/mi-reporte', label: 'Mi Reporte' },
  { path: '/admin/users', label: 'Usuarios' },
  { path: '/admin/roles', label: 'Roles' },
  { path: '/admin/permissions', label: 'Permisos' },
]

export async function GET() {
  try {
    await requireAdmin()

    const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } })
    const permissions = await prisma.pagePermission.findMany({
      include: { role: true },
    })

    // Build matrix: { page: { roleId: boolean } }
    const matrix: Record<string, Record<number, boolean>> = {}
    for (const p of ALL_PAGES) {
      matrix[p.path] = {}
      for (const r of roles) {
        matrix[p.path][r.id] = false
      }
    }
    for (const perm of permissions) {
      if (matrix[perm.page]) {
        matrix[perm.page][perm.roleId] = true
      }
    }

    return NextResponse.json({ pages: ALL_PAGES, roles, matrix })
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}

export async function PUT(req: Request) {
  try {
    await requireAdmin()
    // Body: { page: string, roleIds: number[] }
    const { page, roleIds } = await req.json()

    if (!page || !Array.isArray(roleIds)) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
    }

    // Replace permissions for this page
    await prisma.pagePermission.deleteMany({ where: { page } })
    if (roleIds.length > 0) {
      await prisma.pagePermission.createMany({
        data: roleIds.map((roleId: number) => ({ page, roleId })),
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
