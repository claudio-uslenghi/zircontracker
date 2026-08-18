import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export type PivotProject = {
  projectId: number
  projectName: string
  projectColor: string
  dailyHours: Record<string, number> // regular hours per day
  dailyExtraHours: Record<string, number> // extra hours per day
  total: number
}

export type PivotResource = {
  resourceId: number
  resourceName: string
  resourceColor: string
  projects: PivotProject[]
  dailyTotals: Record<string, number> // regular + extra per day
  total: number
}

export type PivotData = { days: string[]; resources: PivotResource[] }

// Shared by the admin pivot view (app/api/time-entries) and the self-service
// pivot view (app/api/me/time-entries) — same aggregation, different `where`.
export async function buildTimeEntriesPivot(where: Prisma.TimeEntryWhereInput): Promise<PivotData> {
  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      resource: { select: { id: true, name: true, color: true } },
      project: { select: { id: true, name: true, color: true } },
    },
    orderBy: [{ resourceId: 'asc' }, { projectId: 'asc' }, { date: 'asc' }],
  })

  type ResourceAccum = Omit<PivotResource, 'projects'> & { projects: Map<number, PivotProject> }

  const resourceMap = new Map<number, ResourceAccum>()
  const daySet = new Set<string>()

  for (const e of entries) {
    const iso = typeof e.date === 'string' ? e.date : (e.date as unknown as Date).toISOString()
    const dayKey = iso.substring(0, 10)
    daySet.add(dayKey)

    if (!resourceMap.has(e.resourceId)) {
      resourceMap.set(e.resourceId, {
        resourceId: e.resourceId,
        resourceName: e.resource.name,
        resourceColor: e.resource.color,
        projects: new Map(),
        dailyTotals: {},
        total: 0,
      })
    }
    const res = resourceMap.get(e.resourceId)!
    if (!res.projects.has(e.projectId)) {
      res.projects.set(e.projectId, {
        projectId: e.projectId,
        projectName: e.project.name,
        projectColor: e.project.color,
        dailyHours: {},
        dailyExtraHours: {},
        total: 0,
      })
    }
    const proj = res.projects.get(e.projectId)!
    if (e.entryType === 'extra') {
      proj.dailyExtraHours[dayKey] = (proj.dailyExtraHours[dayKey] ?? 0) + e.hours
    } else {
      proj.dailyHours[dayKey] = (proj.dailyHours[dayKey] ?? 0) + e.hours
    }
    proj.total += e.hours
    res.dailyTotals[dayKey] = (res.dailyTotals[dayKey] ?? 0) + e.hours
    res.total += e.hours
  }

  const days = Array.from(daySet).sort()
  const resources = Array.from(resourceMap.values())
    .sort((a, b) => a.resourceName.localeCompare(b.resourceName))
    .map((r) => ({ ...r, projects: Array.from(r.projects.values()).sort((a, b) => b.total - a.total) }))

  return { days, resources }
}
