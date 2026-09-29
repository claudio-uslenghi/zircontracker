export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

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

  const maxOrder = await prisma.invoiceLineDef.aggregate({ where: { blockId }, _max: { order: true } })

  const item = await prisma.invoiceLineDef.create({
    data: {
      blockId,
      refSlug,
      order: (maxOrder._max.order ?? -1) + 1,
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
  return NextResponse.json(item, { status: 201 })
}
