export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { computeInsertOrder, validateRefsOrder } from '@/lib/invoice-block-order'

function slugifyRef(s: string): string {
  return (
    s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item'
  )
}

const VALID_TYPES = ['text', 'blank', 'line', 'sum', 'vat', 'discount']

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const blockId = Number(params.id)
  if (!Number.isInteger(blockId)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  const body = await req.json()
  const type = String(body.type ?? '')
  if (!VALID_TYPES.includes(type)) return NextResponse.json({ error: 'Tipo de línea inválido' }, { status: 400 })

  // sum.over / vat.of / discount.from all arrive as an array of refSlug in `refs`.
  const refs: string[] = Array.isArray(body.refs) ? body.refs : body.refs ? [String(body.refs)] : []
  if ((type === 'sum' || type === 'vat' || type === 'discount') && refs.length === 0) {
    return NextResponse.json({ error: 'Elegí al menos una línea anterior como base' }, { status: 400 })
  }

  const base = slugifyRef(body.label || type)
  let refSlug = `${base}-${Date.now().toString(36)}`
  // extremely unlikely collision, but keep it honest
  while (await prisma.invoiceLineDef.findUnique({ where: { blockId_refSlug: { blockId, refSlug } } })) {
    refSlug = `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  }

  // New lines land right before the block's first total row (sum/vat/
  // discount), grouped with the other data lines, instead of always at the
  // very end — that's what caused a new line to render "below the total"
  // and silently get excluded from it.
  const order = await computeInsertOrder(blockId, type)

  if (refs.length > 0) {
    const err = await validateRefsOrder(blockId, refs, order)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  // A new `line` can opt into one or more of the block's existing subtotals
  // (checked by default in the UI) — without this, a line added after a
  // Subtotal already exists just sits there uncounted, which is exactly what
  // happened with Andre Conrado's "Dev" line on Ideal Protein.
  const includeInSums: number[] = Array.isArray(body.includeInSums) ? body.includeInSums.map(Number) : []

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.invoiceLineDef.create({
      data: {
        blockId,
        refSlug,
        order,
        type,
        label: String(body.label ?? ''),
        rate: type === 'line' && body.rate != null ? Number(body.rate) : null,
        rateFormula: type === 'line' ? body.rateFormula || null : null,
        hasPerson: type === 'line' ? Boolean(body.hasPerson) : false,
        resourceId: type === 'line' && body.hasPerson && body.resourceId != null ? Number(body.resourceId) : null,
        qtyDefault: type === 'line' && body.qtyDefault != null ? Number(body.qtyDefault) : 0,
        comment: String(body.comment ?? ''),
        refs: refs.join(','),
        factor: (type === 'vat' || type === 'discount') && body.factor != null ? Number(body.factor) : null,
        qtyIsSum: type === 'sum' ? Boolean(body.qtyIsSum) : false,
        avgRate: type === 'sum' ? Boolean(body.avgRate) : false,
      },
    })

    if (type === 'line' && includeInSums.length > 0) {
      const sums = await tx.invoiceLineDef.findMany({ where: { id: { in: includeInSums }, blockId, type: 'sum' } })
      for (const sum of sums) {
        const parts = sum.refs ? sum.refs.split(',') : []
        if (!parts.includes(created.refSlug)) {
          await tx.invoiceLineDef.update({ where: { id: sum.id }, data: { refs: [...parts, created.refSlug].join(',') } })
        }
      }
    }

    return created
  })
  return NextResponse.json(item, { status: 201 })
}
