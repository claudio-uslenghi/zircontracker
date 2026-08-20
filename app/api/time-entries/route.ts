import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-options'
import { prisma } from '@/lib/prisma'
import { buildTimeEntriesPivot } from '@/lib/time-entries-pivot'
import type { TimeEntryByResource, TimeEntryByProject, TimeEntryByMonth } from '@/types'

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const roles = (session?.user as { roles?: string[] })?.roles ?? []
  if (!roles.includes('admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const month = searchParams.get('month') // YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Parámetro month inválido (YYYY-MM)' }, { status: 400 })
  }

  const [y, m] = month.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0))
  const to   = new Date(Date.UTC(y, m,     0, 23, 59, 59))

  const { count } = await prisma.timeEntry.deleteMany({
    where: { date: { gte: from, lte: to } },
  })

  return NextResponse.json({ deleted: count, month })
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const resourceId = searchParams.get('resourceId')
  const projectId = searchParams.get('projectId')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')
  const month = searchParams.get('month') // YYYY-MM
  const view = searchParams.get('view') ?? 'raw'
  const page = parseInt(searchParams.get('page') ?? '1')
  const pageSize = parseInt(searchParams.get('pageSize') ?? '100')

  // Build date range
  let from: Date | undefined
  let to: Date | undefined

  if (month) {
    const [y, m] = month.split('-').map(Number)
    from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0))
    to = new Date(Date.UTC(y, m, 0, 23, 59, 59))
  } else {
    if (dateFrom) from = new Date(dateFrom + 'T00:00:00Z')
    if (dateTo) to = new Date(dateTo + 'T23:59:59Z')
  }

  const where: Record<string, unknown> = {}
  if (resourceId) where.resourceId = parseInt(resourceId)
  if (projectId) where.projectId = parseInt(projectId)
  if (from || to) {
    where.date = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    }
  }

  if (view === 'by-resource') {
    const entries = await prisma.timeEntry.findMany({
      where,
      include: { resource: { select: { id: true, name: true, color: true } } },
    })
    const map = new Map<number, TimeEntryByResource>()
    for (const e of entries) {
      const existing = map.get(e.resourceId)
      if (existing) {
        existing.totalHours += e.hours
      } else {
        map.set(e.resourceId, {
          resourceId: e.resourceId,
          resourceName: e.resource.name,
          resourceColor: e.resource.color,
          totalHours: e.hours,
        })
      }
    }
    const result = Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours)
    return NextResponse.json(result)
  }

  if (view === 'by-project') {
    const entries = await prisma.timeEntry.findMany({
      where,
      include: { project: { select: { id: true, name: true, color: true } } },
    })
    const map = new Map<number, TimeEntryByProject>()
    for (const e of entries) {
      const existing = map.get(e.projectId)
      if (existing) {
        existing.totalHours += e.hours
      } else {
        map.set(e.projectId, {
          projectId: e.projectId,
          projectName: e.project.name,
          projectColor: e.project.color,
          totalHours: e.hours,
        })
      }
    }
    const result = Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours)
    return NextResponse.json(result)
  }

  if (view === 'by-month') {
    const entries = await prisma.timeEntry.findMany({
      where,
      select: { date: true, hours: true },
      orderBy: { date: 'asc' },
    })
    const map = new Map<string, number>()
    for (const e of entries) {
      const dateStr = typeof e.date === 'string'
        ? e.date
        : (e.date as unknown as Date).toISOString()
      const monthKey = dateStr.substring(0, 7) // YYYY-MM
      map.set(monthKey, (map.get(monthKey) ?? 0) + e.hours)
    }
    const result: TimeEntryByMonth[] = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, totalHours]) => ({ month, totalHours }))
    return NextResponse.json(result)
  }

  if (view === 'pivot') {
    const pivot = await buildTimeEntriesPivot(where, { from, to })
    return NextResponse.json(pivot)
  }

  // Default: raw with pagination + dynamic sort
  const sortBy  = searchParams.get('sortBy')  ?? 'date'
  const sortDir = (searchParams.get('sortDir') ?? 'desc') as 'asc' | 'desc'

  const orderByMap: Record<string, object[]> = {
    resource: [{ resource: { name: sortDir } }, { date: 'desc' }],
    project:  [{ project:  { name: sortDir } }, { date: 'desc' }],
    date:     [{ date: sortDir },               { resourceId: 'asc' }],
  }
  const orderBy = orderByMap[sortBy] ?? orderByMap.date

  const total = await prisma.timeEntry.count({ where })
  const entries = await prisma.timeEntry.findMany({
    where,
    select: {
      id: true, resourceId: true, projectId: true, date: true, hours: true, entryType: true,
      resource: { select: { id: true, name: true, color: true } },
      project:  { select: { id: true, name: true, color: true } },
    },
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  return NextResponse.json({ total, page, pageSize, entries })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const roles = (session?.user as { roles?: string[] })?.roles ?? []
  if (!roles.includes('admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { resourceId, projectId, date, hours } = body
  if (!resourceId || !projectId || !date || !hours) {
    return NextResponse.json(
      { error: 'Campos requeridos: resourceId, projectId, date, hours' },
      { status: 400 },
    )
  }

  try {
    const entry = await prisma.timeEntry.create({
      data: {
        resourceId: Number(resourceId),
        projectId:  Number(projectId),
        date:       new Date(date),
        hours:      Number(hours),
      },
      include: {
        resource: { select: { id: true, name: true, color: true } },
        project:  { select: { id: true, name: true, color: true } },
      },
    })
    return NextResponse.json(entry, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: 'Conflicto: ya existe una entrada para ese recurso/proyecto/día' },
      { status: 409 },
    )
  }
}
