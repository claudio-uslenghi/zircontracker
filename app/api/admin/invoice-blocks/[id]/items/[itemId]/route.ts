export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { validateRefsOrder } from '@/lib/invoice-block-order'

// Edits an existing line's own fields (label, rate, person, refs, factor,
// etc). Reordering goes through the dedicated .../move endpoint instead —
// swapping `order` here directly risked colliding with the (blockId, order)
// unique constraint on another row.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const blockId = Number(params.id)
  const itemId = Number(params.itemId)
  if (!Number.isInteger(itemId)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  const existing = await prisma.invoiceLineDef.findUnique({ where: { id: itemId } })
  if (!existing) return NextResponse.json({ error: 'No existe' }, { status: 404 })

  const body = await req.json()
  const data: Record<string, unknown> = {}
  if (body.label !== undefined) data.label = String(body.label)
  if (body.rate !== undefined) data.rate = body.rate != null ? Number(body.rate) : null
  if (body.rateFormula !== undefined) data.rateFormula = body.rateFormula || null
  if (body.hasPerson !== undefined) data.hasPerson = Boolean(body.hasPerson)
  if (body.resourceId !== undefined) data.resourceId = body.resourceId != null ? Number(body.resourceId) : null
  if (body.qtyDefault !== undefined) data.qtyDefault = Number(body.qtyDefault)
  if (body.comment !== undefined) data.comment = String(body.comment)
  if (body.factor !== undefined) data.factor = body.factor != null ? Number(body.factor) : null
  if (body.qtyIsSum !== undefined) data.qtyIsSum = Boolean(body.qtyIsSum)
  if (body.avgRate !== undefined) data.avgRate = Boolean(body.avgRate)

  if (body.refs !== undefined) {
    const refs: string[] = Array.isArray(body.refs) ? body.refs : body.refs ? [String(body.refs)] : []
    if ((existing.type === 'sum' || existing.type === 'vat' || existing.type === 'discount') && refs.length === 0) {
      return NextResponse.json({ error: 'Elegí al menos una línea anterior como base' }, { status: 400 })
    }
    if (refs.length > 0) {
      const err = await validateRefsOrder(blockId, refs, existing.order, itemId)
      if (err) return NextResponse.json({ error: err }, { status: 400 })
    }
    data.refs = refs.join(',')
  }

  try {
    const item = await prisma.invoiceLineDef.update({ where: { id: itemId }, data })
    return NextResponse.json(item)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const blockId = Number(params.id)
  const itemId = Number(params.itemId)
  if (!Number.isInteger(itemId)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  const item = await prisma.invoiceLineDef.findUnique({ where: { id: itemId }, select: { refSlug: true } })
  if (!item) return NextResponse.json({ error: 'No existe' }, { status: 404 })

  // Refuse to delete a line another sum/vat/discount in the same block still
  // references — the referencing row would silently lose its base otherwise.
  const referencing = await prisma.invoiceLineDef.findMany({
    where: { blockId, id: { not: itemId } },
    select: { label: true, refs: true },
  })
  const stillReferenced = referencing.filter((r) => r.refs.split(',').includes(item.refSlug))
  if (stillReferenced.length > 0) {
    return NextResponse.json(
      { error: `No se puede borrar: la usa${stillReferenced.length > 1 ? 'n' : ''} "${stillReferenced.map((r) => r.label || '(sin nombre)').join('", "')}". Editá o borrá esa línea primero.` },
      { status: 409 }
    )
  }

  await prisma.invoiceLineDef.delete({ where: { id: itemId } })
  return NextResponse.json({ ok: true })
}
