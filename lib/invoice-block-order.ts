// Sparse ordering for InvoiceLineDef rows within a block: order values are
// spaced out (multiples of 1000) so inserting a line "between" two existing
// ones is just picking the midpoint — no need to shift every other row (and
// no risk of colliding with the (blockId, order) unique constraint).
import { prisma } from '@/lib/prisma'

const ORDER_STEP = 1000

// A value strictly between `before` and `after` (either may be null for "no
// neighbor on that side"). Returns null when there's no integer room left —
// caller should resequenceBlock() first, then retry.
export function orderBetween(before: number | null, after: number | null): number | null {
  if (before == null && after == null) return ORDER_STEP
  if (before == null) return after! - ORDER_STEP
  if (after == null) return before! + ORDER_STEP
  const mid = Math.floor((before + after) / 2)
  if (mid <= before || mid >= after) return null
  return mid
}

// Rare fallback: re-spaces every item in the block to clean 1000-step values
// (order of insertion preserved). Two-phase (temp negative range, then final
// values) so no intermediate update can collide with the unique constraint.
export async function resequenceBlock(blockId: number): Promise<void> {
  const items = await prisma.invoiceLineDef.findMany({ where: { blockId }, orderBy: { order: 'asc' }, select: { id: true } })
  await prisma.$transaction([
    ...items.map((it, i) => prisma.invoiceLineDef.update({ where: { id: it.id }, data: { order: -1_000_000 - i } })),
    ...items.map((it, i) => prisma.invoiceLineDef.update({ where: { id: it.id }, data: { order: (i + 1) * ORDER_STEP } })),
  ])
}

// Order for a newly-created item. A data `line` lands right before the
// block's first total row (sum/vat/discount) — grouped with the other data
// lines instead of always at the very end, which is what caused a new line
// to render "below the total" and silently get excluded from it. A new
// sum/vat/discount (a new total) always goes at the very end, same as before.
export async function computeInsertOrder(blockId: number, newItemType: string): Promise<number> {
  const items = await prisma.invoiceLineDef.findMany({ where: { blockId }, orderBy: { order: 'asc' }, select: { order: true, type: true } })
  if (items.length === 0) return ORDER_STEP

  const isTotalType = newItemType === 'sum' || newItemType === 'vat' || newItemType === 'discount'
  let before: number | null
  let after: number | null
  if (isTotalType) {
    before = items[items.length - 1].order
    after = null
  } else {
    const firstTotalIdx = items.findIndex((it) => it.type === 'sum' || it.type === 'vat' || it.type === 'discount')
    before = firstTotalIdx > 0 ? items[firstTotalIdx - 1].order : firstTotalIdx === 0 ? null : items[items.length - 1].order
    after = firstTotalIdx >= 0 ? items[firstTotalIdx].order : null
  }

  const slot = orderBetween(before, after)
  if (slot !== null) return slot

  // No integer room left between neighbors — resequence, then it's a clean gap.
  await resequenceBlock(blockId)
  return computeInsertOrder(blockId, newItemType)
}

// A sum/vat/discount can only reference rows the calc engine has already
// seen (computeInvoice processes items in order, accumulating a byId map as
// it goes) — a forward reference silently resolves to "not found" and that
// part of the total is just dropped, with no error shown anywhere. Reject it
// here instead. `excludeItemId` lets a PATCH validate against the item's own
// current order without matching itself.
export async function validateRefsOrder(
  blockId: number,
  refSlugs: string[],
  ownOrder: number,
  excludeItemId?: number
): Promise<string | null> {
  if (refSlugs.length === 0) return null
  const rows = await prisma.invoiceLineDef.findMany({
    where: { blockId, refSlug: { in: refSlugs }, ...(excludeItemId ? { id: { not: excludeItemId } } : {}) },
    select: { refSlug: true, order: true, label: true },
  })
  const bySlug = new Map(rows.map((r) => [r.refSlug, r]))
  for (const slug of refSlugs) {
    const row = bySlug.get(slug)
    if (!row) return `La línea referenciada "${slug}" no existe en este bloque.`
    if (row.order >= ownOrder) return `"${row.label || slug}" está después en el orden — no se puede usar como base (el cálculo la ignoraría en silencio).`
  }
  return null
}

// Swaps the display order of two items (used by the up/down move endpoint).
// Goes through a temp value so the (blockId, order) unique index is never
// hit with a duplicate mid-transaction.
export async function swapOrder(idA: number, orderA: number, idB: number, orderB: number): Promise<void> {
  await prisma.$transaction([
    prisma.invoiceLineDef.update({ where: { id: idA }, data: { order: -999_999_999 } }),
    prisma.invoiceLineDef.update({ where: { id: idB }, data: { order: orderA } }),
    prisma.invoiceLineDef.update({ where: { id: idA }, data: { order: orderB } }),
  ])
}
