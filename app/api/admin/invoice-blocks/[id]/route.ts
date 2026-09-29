export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = Number(params.id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  const body = await req.json()
  const data: Record<string, unknown> = {}
  if (body.client !== undefined) data.client = String(body.client).trim()
  if (body.customerName !== undefined) data.customerName = String(body.customerName).trim()
  if (body.active !== undefined) data.active = Boolean(body.active)
  if (body.order !== undefined) data.order = Number(body.order)
  if (body.header !== undefined) data.header = Boolean(body.header)
  if (body.okMark !== undefined) data.okMark = Boolean(body.okMark)
  if (body.priceLabel !== undefined) data.priceLabel = String(body.priceLabel)
  if (body.qtyLabel !== undefined) data.qtyLabel = String(body.qtyLabel)
  if (body.unit !== undefined) data.unit = body.unit === 'days' ? 'days' : 'hours'
  if (body.projectId !== undefined) data.projectId = body.projectId != null ? Number(body.projectId) : null
  if (body.paymentTermDays !== undefined) data.paymentTermDays = Number(body.paymentTermDays)

  try {
    const block = await prisma.invoiceBlock.update({ where: { id }, data })
    return NextResponse.json(block)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = Number(params.id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  const block = await prisma.invoiceBlock.findUnique({ where: { id }, select: { slug: true } })
  if (!block) return NextResponse.json({ error: 'No existe' }, { status: 404 })

  // A block that already generated a real ClientInvoice keeps its history —
  // only a block with zero history can be truly deleted (use "Ocultar" otherwise).
  const historyCount = await prisma.clientInvoice.count({ where: { blockId: block.slug } })
  if (historyCount > 0) {
    return NextResponse.json(
      { error: `Este cliente ya generó ${historyCount} factura${historyCount !== 1 ? 's' : ''} — ocultalo en vez de borrarlo para no perder el historial.` },
      { status: 409 }
    )
  }

  await prisma.invoiceBlock.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
