export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { sortByEffectiveOrder } from '@/lib/pivot-order'
import { BENCH_COLUMN_ID, BENCH_COLUMN_NAME, computeBenchHours } from '@/lib/invoicing-bench'

// Preview for the monthly "Info para invoicing" report: Proyecto/Recurso
// columns & rows come straight from the DB (invoicingHidden: false, ordered
// by invoicingOrder — see wizard step 1, lib/pivot-order.ts), not from a
// hardcoded list anymore, so there's nothing that can fail to "exist" — the
// only thing worth flagging is a visible resource/project with zero hours
// this month (informational, not actionable here; hiding happens in step 1).
export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const month = req.nextUrl.searchParams.get('month') // YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Parámetro month inválido (YYYY-MM)' }, { status: 400 })
  }
  const [y, m] = month.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0))
  const to = new Date(Date.UTC(y, m, 0, 23, 59, 59))

  const [allResources, allProjects] = await Promise.all([
    prisma.resource.findMany({ where: { invoicingHidden: false }, select: { id: true, name: true, invoicingOrder: true } }),
    prisma.project.findMany({ where: { invoicingHidden: false }, select: { id: true, name: true, invoicingOrder: true } }),
  ])
  const resources = sortByEffectiveOrder(allResources)
  const projects = sortByEffectiveOrder(allProjects)

  const resourceIds = resources.map((r) => r.id)
  const grouped = resourceIds.length
    ? await prisma.timeEntry.groupBy({
        by: ['resourceId', 'projectId'],
        where: { date: { gte: from, lte: to }, resourceId: { in: resourceIds } },
        _sum: { hours: true },
      })
    : []

  const hoursMap = new Map<string, number>()
  for (const g of grouped) hoursMap.set(`${g.resourceId}|${g.projectId}`, g._sum.hours ?? 0)

  const visibleTotalByResource = new Map<number, number>()
  const resourceRows = resources.map((r) => {
    const hoursByProject: Record<number, number> = {}
    let total = 0
    for (const p of projects) {
      const hours = hoursMap.get(`${r.id}|${p.id}`) ?? 0
      hoursByProject[p.id] = Math.round(hours * 100) / 100
      total += hours
    }
    visibleTotalByResource.set(r.id, total)
    return { id: r.id, name: r.name, total: Math.round(total * 100) / 100, hasData: total > 0, hoursByProject }
  })

  const benchByResource = await computeBenchHours(resourceIds, visibleTotalByResource, from, to)
  for (const r of resourceRows) {
    const bench = benchByResource.get(r.id) ?? 0
    r.hoursByProject[BENCH_COLUMN_ID] = bench
    r.total = Math.round((r.total + bench) * 100) / 100
    r.hasData = r.hasData || bench > 0
  }
  const benchTotal = resourceRows.reduce((sum, r) => sum + (r.hoursByProject[BENCH_COLUMN_ID] ?? 0), 0)

  const projectRows = [
    ...projects.map((p) => {
      const total = resourceRows.reduce((sum, r) => sum + (r.hoursByProject[p.id] ?? 0), 0)
      return { id: p.id, name: p.name, total: Math.round(total * 100) / 100, hasData: total > 0 }
    }),
    { id: BENCH_COLUMN_ID, name: BENCH_COLUMN_NAME, total: Math.round(benchTotal * 100) / 100, hasData: benchTotal > 0 },
  ]

  const warnings: string[] = [
    ...resourceRows.filter((r) => !r.hasData).map((r) => `"${r.name}" no tiene horas cargadas en ${month}.`),
    ...projectRows.filter((p) => !p.hasData && p.id !== BENCH_COLUMN_ID).map((p) => `"${p.name}" no tiene horas cargadas en ${month}.`),
  ]

  return NextResponse.json({ month, resources: resourceRows, projects: projectRows, warnings })
}
