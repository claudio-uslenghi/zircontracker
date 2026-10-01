// Visibility + order for the "Info para invoicing" pivot (wizard step 1),
// stored directly on Project/Resource (invoicingHidden/invoicingOrder — see
// SPEC.md "Wizard de facturación mensual"). Replaces the old hardcoded
// INVOICING_PROJECT_ORDER/INVOICING_RESOURCE_ORDER lists in
// lib/invoicing-report.ts.
//
// Unlike lib/invoice-block-order.ts (which supports inserting a new line
// "between" two existing ones, so it needs sparse spacing), nothing here
// ever gets inserted mid-list — items only get hidden/shown or moved. So on
// every move we just resequence the whole list to clean 1000-step values;
// at this scale (tens of rows) that's simpler and just as correct as sparse
// math, and it also "materializes" any still-null invoicingOrder (a
// recently auto-added Project/Resource) into a real value the first time
// it's touched.
import { prisma } from './prisma'

export type PivotKind = 'project' | 'resource'

export interface PivotItemRow {
  id: number
  name: string
  invoicingHidden: boolean
  invoicingOrder: number | null
}

const ORDER_STEP = 1000

// Explicit order first (ascending); anything still null (not yet positioned
// by hand — e.g. just auto-added) goes last, alphabetically among itself.
export function sortByEffectiveOrder<T extends { invoicingOrder: number | null; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.invoicingOrder != null && b.invoicingOrder != null) return a.invoicingOrder - b.invoicingOrder
    if (a.invoicingOrder != null) return -1
    if (b.invoicingOrder != null) return 1
    return a.name.localeCompare(b.name)
  })
}

async function fetchSorted(kind: PivotKind): Promise<PivotItemRow[]> {
  const rows = kind === 'project'
    ? await prisma.project.findMany({ select: { id: true, name: true, invoicingHidden: true, invoicingOrder: true } })
    : await prisma.resource.findMany({ select: { id: true, name: true, invoicingHidden: true, invoicingOrder: true } })
  return sortByEffectiveOrder(rows)
}

// Full list (hidden + visible), for the step-1 management screen.
export async function listPivotItems(kind: PivotKind): Promise<PivotItemRow[]> {
  return fetchSorted(kind)
}

export async function setPivotHidden(kind: PivotKind, id: number, hidden: boolean): Promise<void> {
  if (kind === 'project') await prisma.project.update({ where: { id }, data: { invoicingHidden: hidden } })
  else await prisma.resource.update({ where: { id }, data: { invoicingHidden: hidden } })
}

// Swaps `id` with its visual neighbor (up = previous row, down = next row)
// and resequences the whole list to clean 1000-step values. No-op if `id`
// is already at that edge.
export async function movePivotItem(kind: PivotKind, id: number, direction: 'up' | 'down'): Promise<void> {
  const sorted = await fetchSorted(kind)
  const idx = sorted.findIndex((r) => r.id === id)
  if (idx === -1) return
  const swapWith = direction === 'up' ? idx - 1 : idx + 1
  if (swapWith < 0 || swapWith >= sorted.length) return

  const next = [...sorted]
  ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]

  const updates = next.map((row, i) =>
    kind === 'project'
      ? prisma.project.update({ where: { id: row.id }, data: { invoicingOrder: (i + 1) * ORDER_STEP } })
      : prisma.resource.update({ where: { id: row.id }, data: { invoicingOrder: (i + 1) * ORDER_STEP } })
  )
  await prisma.$transaction(updates)
}
