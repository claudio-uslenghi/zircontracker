export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { swapOrder } from '@/lib/invoice-block-order'

// Moves a line up/down by swapping its display order with the immediate
// neighbor. A dedicated endpoint (rather than a raw `order` field on the
// generic PATCH) so the swap always goes through a temp value and never hits
// the (blockId, order) unique constraint.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const blockId = Number(params.id)
  const itemId = Number(params.itemId)
  if (!Number.isInteger(blockId) || !Number.isInteger(itemId)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  }

  const body = await req.json()
  const direction = body.direction === 'up' ? 'up' : body.direction === 'down' ? 'down' : null
  if (!direction) return NextResponse.json({ error: 'direction debe ser up o down' }, { status: 400 })

  const items = await prisma.invoiceLineDef.findMany({ where: { blockId }, orderBy: { order: 'asc' } })
  const idx = items.findIndex((it) => it.id === itemId)
  if (idx === -1) return NextResponse.json({ error: 'No existe' }, { status: 404 })

  const neighborIdx = direction === 'up' ? idx - 1 : idx + 1
  if (neighborIdx < 0 || neighborIdx >= items.length) {
    return NextResponse.json({ error: 'Ya está en el extremo' }, { status: 400 })
  }
  const current = items[idx]
  const neighbor = items[neighborIdx]

  // A sum/vat/discount can only reference rows earlier in the order (see
  // lib/invoice-block-order.ts) — check every row's refs against the orders
  // this swap would produce, not just the two rows swapping, since a chain
  // further down could also depend on one of them.
  const currentNewOrder = neighbor.order
  const neighborNewOrder = current.order
  const orderAfterSwap = new Map(
    items.map((it) => [it.id, it.id === current.id ? currentNewOrder : it.id === neighbor.id ? neighborNewOrder : it.order])
  )
  for (const it of items) {
    if (!it.refs) continue
    const ownOrder = orderAfterSwap.get(it.id)!
    for (const slug of it.refs.split(',')) {
      const ref = items.find((x) => x.refSlug === slug)
      if (ref && orderAfterSwap.get(ref.id)! >= ownOrder) {
        return NextResponse.json(
          { error: `Ese movimiento dejaría a "${it.label || it.refSlug}" antes que su base "${ref.label || slug}".` },
          { status: 400 }
        )
      }
    }
  }

  await swapOrder(current.id, current.order, neighbor.id, neighbor.order)
  return NextResponse.json({ ok: true })
}
