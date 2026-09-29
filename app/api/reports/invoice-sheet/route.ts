export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { getInvoiceTemplate } from '@/lib/invoice-template'

// Data the "Facturas" preview needs (read-only): the resolved template itself
// (blocks/items now live in the DB — see lib/invoice-template.ts) plus the
// month's hours per (person, project) for the client projects, so the client
// can build initial line states and recompute a line when the admin picks a
// different person, without extra requests. Same groupBy as the pivot.
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

  const [blocks, allResources, allProjects] = await Promise.all([
    getInvoiceTemplate({ activeOnly: true }),
    prisma.resource.findMany({ select: { id: true, name: true } }),
    prisma.project.findMany({ select: { id: true, name: true } }),
  ])
  const resourceNames = allResources.map((r) => r.name)

  const warnings: string[] = []
  const blockProjects: Record<string, string | null> = {}
  const lineDefaults: Record<string, string | null> = {}

  for (const block of blocks) {
    const projectName = block.projectLookup?.[0] ?? null
    blockProjects[block.id] = projectName
    if (block.projectLookup && !projectName) warnings.push(`Cliente "${block.client}": no tiene un proyecto vinculado en la base, cargá las horas a mano.`)
    for (const item of block.items) {
      if (item.type !== 'line' || item.person === undefined) continue
      lineDefaults[item.id] = item.person
    }
  }

  const projectNames = Object.values(blockProjects).filter((n): n is string => !!n)
  const projectIdByName = new Map(allProjects.map((p) => [p.name, p.id]))
  const resourceById = new Map(allResources.map((r) => [r.id, r.name]))
  const projectNameById = new Map(allProjects.map((p) => [p.id, p.name]))

  const grouped = projectNames.length
    ? await prisma.timeEntry.groupBy({
        by: ['resourceId', 'projectId'],
        where: {
          date: { gte: from, lte: to },
          projectId: { in: projectNames.map((n) => projectIdByName.get(n)!) },
        },
        _sum: { hours: true },
      })
    : []

  const hours: Record<string, Record<string, number>> = {}
  for (const g of grouped) {
    const resName = resourceById.get(g.resourceId)?.trim()
    const projName = projectNameById.get(g.projectId)
    const value = g._sum.hours ?? 0
    if (!resName || !projName || value <= 0) continue
    if (!hours[resName]) hours[resName] = {}
    hours[resName][projName] = value
  }

  return NextResponse.json({
    month,
    blocks,
    blockProjects,
    lineDefaults,
    hours,
    resourceNames: resourceNames.map((n) => n.trim()).sort((a, b) => a.localeCompare(b)),
    warnings,
  })
}
