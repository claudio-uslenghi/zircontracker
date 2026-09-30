export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { computeInvoiceStatus } from '@/lib/invoice-records'

// Lists every ClientInvoice record with its payments and Outstanding/
// Outstanding days/status computed on the fly (never stored — see
// lib/invoice-records.ts). Filtering and sorting happen client-side; the
// table is small enough not to need server-side pagination yet. Also
// returns every InvoiceBlock (active AND hidden) so the UI can label a
// historical row whose client was since hidden.
export async function GET() {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [records, blocks] = await Promise.all([
    prisma.clientInvoice.findMany({
      orderBy: [{ month: 'desc' }, { customer: 'asc' }],
      include: { payments: { orderBy: { date: 'asc' } } },
    }),
    prisma.invoiceBlock.findMany({ select: { slug: true, client: true, paymentTermDays: true } }),
  ])
  const blockBySlug = new Map(blocks.map((b) => [b.slug, b]))

  const rows = records.map((r) => {
    const termDays = blockBySlug.get(r.blockId)?.paymentTermDays ?? 30
    const computed = computeInvoiceStatus({
      termDays, billed: r.billed, dateInv: r.dateInv, payments: r.payments,
    })
    return {
      id: r.id,
      month: r.month,
      blockId: r.blockId,
      company: r.company,
      customer: r.customer,
      description: r.description,
      total: r.total,
      billed: r.billed,
      dateInv: r.dateInv.toISOString().slice(0, 10),
      comments: r.comments,
      payments: r.payments.map((p) => ({ id: p.id, amount: p.amount, date: p.date.toISOString().slice(0, 10), comment: p.comment })),
      paidAmount: computed.paidAmount,
      outstanding: computed.outstanding,
      outstandingDays: computed.outstandingDays,
      status: computed.status,
    }
  })

  return NextResponse.json({
    rows,
    blocks: blocks.map((b) => ({ blockId: b.slug, client: b.client })),
  })
}
