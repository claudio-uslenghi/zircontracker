export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireOwnResource } from '@/lib/auth'
import { buildTimeEntriesPivot } from '@/lib/time-entries-pivot'

function forbiddenOrNoResource(err: unknown) {
  const msg = err instanceof Error ? err.message : 'Error'
  if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (msg === 'NoResource') {
    return NextResponse.json(
      { error: 'Tu usuario no está vinculado a ningún recurso. Pedile a un admin que le agregue tu email al recurso correspondiente.' },
      { status: 404 }
    )
  }
  return NextResponse.json({ error: msg }, { status: 500 })
}

export async function GET(req: NextRequest) {
  try {
    const resource = await requireOwnResource()

    const { searchParams } = req.nextUrl
    const projectId = searchParams.get('projectId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const month = searchParams.get('month') // YYYY-MM
    const view = searchParams.get('view') ?? 'raw'

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

    const where: Prisma.TimeEntryWhereInput = { resourceId: resource.id }
    if (projectId) where.projectId = Number(projectId)
    if (from || to) {
      where.date = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      }
    }

    if (view === 'pivot') {
      const pivot = await buildTimeEntriesPivot(where, { from, to })
      return NextResponse.json(pivot)
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, color: true } },
        task: { select: { id: true, name: true } },
      },
      orderBy: [{ date: 'asc' }],
    })
    return NextResponse.json(entries)
  } catch (err: unknown) {
    return forbiddenOrNoResource(err)
  }
}

// Upsert a single grid cell for the detailed (per-task) entry mode.
// Body: { projectId, taskId?: number | null, date, hours, entryType? }
// hours <= 0 deletes the entry instead of storing a zero row.
export async function PUT(req: NextRequest) {
  try {
    const resource = await requireOwnResource()
    const body = await req.json()

    const projectId = Number(body.projectId)
    const taskId = body.taskId != null ? Number(body.taskId) : null
    const date = new Date(body.date)
    const entryType = body.entryType ?? 'regular'
    const hours = Number(body.hours)

    if (!projectId || Number.isNaN(date.getTime()) || Number.isNaN(hours)) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
    }

    const identity = { resourceId: resource.id, projectId, date, entryType, taskId }

    // The compound unique index includes taskId, which is nullable — Prisma's
    // generated compound-unique `where` shorthand doesn't accept null there,
    // so we find-then-write manually instead of relying on upsert/ON CONFLICT.
    const existing = await prisma.timeEntry.findFirst({ where: identity })

    if (hours <= 0) {
      if (existing) await prisma.timeEntry.delete({ where: { id: existing.id } })
      return NextResponse.json({ deleted: true })
    }

    const entry = existing
      ? await prisma.timeEntry.update({ where: { id: existing.id }, data: { hours } })
      : await prisma.timeEntry.create({ data: { ...identity, hours } })
    return NextResponse.json(entry)
  } catch (err: unknown) {
    return forbiddenOrNoResource(err)
  }
}

// Bulk month fill for Time & Material resources that don't break hours down
// by task. Body: { projectId, year, month (1-12), defaultHours, overrides?: { [day]: hours } }
// Skips weekends. Idempotent: running it twice updates existing rows instead
// of duplicating them (same find-then-write pattern as PUT, since taskId is
// always null here and Prisma's compound-unique shorthand can't target null).
export async function POST(req: NextRequest) {
  try {
    const resource = await requireOwnResource()
    const body = await req.json()

    const projectId = Number(body.projectId)
    const year = Number(body.year)
    const month = Number(body.month)
    const defaultHours = Number(body.defaultHours)
    const overrides: Record<string, number> = body.overrides ?? {}

    if (!projectId || !year || !month || Number.isNaN(defaultHours)) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
    }

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const saved: { date: string; hours: number }[] = []

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
      const dow = date.getUTCDay()
      if (dow === 0 || dow === 6) continue // skip weekends

      const hours = overrides[String(day)] ?? defaultHours
      if (!hours || hours <= 0) continue

      const identity = { resourceId: resource.id, projectId, date, entryType: 'regular', taskId: null }
      const existing = await prisma.timeEntry.findFirst({ where: identity })
      if (existing) {
        await prisma.timeEntry.update({ where: { id: existing.id }, data: { hours } })
      } else {
        await prisma.timeEntry.create({ data: { ...identity, hours } })
      }
      saved.push({ date: date.toISOString(), hours })
    }

    return NextResponse.json({ saved: saved.length, entries: saved })
  } catch (err: unknown) {
    return forbiddenOrNoResource(err)
  }
}

// Delete a single own entry by id (?id=), or bulk-delete a whole T&M month
// for one project (?projectId=&month=YYYY-MM) — same query-param shape as
// the admin bulk delete in app/api/time-entries/route.ts. The bulk path is
// scoped to taskId: null so it only ever touches T&M entries, never the
// per-task rows from the Detallado mode for the same project/month.
export async function DELETE(req: NextRequest) {
  try {
    const resource = await requireOwnResource()
    const { searchParams } = req.nextUrl
    const id = searchParams.get('id')

    if (id) {
      const entry = await prisma.timeEntry.findUnique({ where: { id: Number(id) } })
      if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (entry.resourceId !== resource.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      await prisma.timeEntry.delete({ where: { id: Number(id) } })
      return NextResponse.json({ ok: true })
    }

    const projectId = Number(searchParams.get('projectId'))
    const month = searchParams.get('month') // YYYY-MM
    if (!projectId || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'Parámetros inválidos (projectId y month=YYYY-MM)' }, { status: 400 })
    }

    const [y, m] = month.split('-').map(Number)
    const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0))
    const to = new Date(Date.UTC(y, m, 0, 23, 59, 59))

    const { count } = await prisma.timeEntry.deleteMany({
      where: { resourceId: resource.id, projectId, taskId: null, date: { gte: from, lte: to } },
    })
    return NextResponse.json({ deleted: count, month })
  } catch (err: unknown) {
    return forbiddenOrNoResource(err)
  }
}
