// "Bench (Internal Issues)" — a synthetic pivot column (not a real Project
// row) that catches the hours a visible Resource logged against projects
// that are hidden from the "Info para invoicing" pivot (wizard step 1).
// Before this existed, those hours just silently vanished from the report —
// a person who only worked on hidden/non-billable projects that month showed
// up as "sin horas" even with real hours logged. See SPEC.md "columna Bench
// (Internal Issues), colores de la hoja Invoicing".
//
// bench = (real total hours that month, across ALL projects) - (hours
// already counted in the visible columns) — equivalent to summing every
// hidden project's hours, without needing to enumerate them.
import { prisma } from './prisma'

export const BENCH_COLUMN_ID = -1
export const BENCH_COLUMN_NAME = 'Bench (Internal Issues)'

export async function computeBenchHours(
  resourceIds: number[],
  visibleTotalByResource: Map<number, number>,
  from: Date,
  to: Date
): Promise<Map<number, number>> {
  if (resourceIds.length === 0) return new Map()
  const grouped = await prisma.timeEntry.groupBy({
    by: ['resourceId'],
    where: { date: { gte: from, lte: to }, resourceId: { in: resourceIds } },
    _sum: { hours: true },
  })
  const bench = new Map<number, number>()
  for (const g of grouped) {
    const grandTotal = g._sum.hours ?? 0
    const visible = visibleTotalByResource.get(g.resourceId) ?? 0
    // Clamp at 0 — a negative value would only happen from a rounding edge
    // case, never a real "negative hours worked" situation.
    bench.set(g.resourceId, Math.max(0, Math.round((grandTotal - visible) * 100) / 100))
  }
  return bench
}
