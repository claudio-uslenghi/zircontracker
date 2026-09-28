export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { computeInvoiceStatus } from '@/lib/invoice-records'

// Lists every ClientInvoice record with Outstanding/Outstanding days/status
// computed on the fly (never stored — see lib/invoice-records.ts). Filtering
// and sorting happen client-side; the table is small enough not to need
// server-side pagination yet.
export async function GET() {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const records = await prisma.clientInvoice.findMany({ orderBy: [{ month: 'desc' }, { customer: 'asc' }] })

  const rows = records.map((r) => {
    const computed = computeInvoiceStatus({
      blockId: r.blockId, billed: r.billed, paid: r.paid, dateInv: r.dateInv, datePaid: r.datePaid,
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
      paid: r.paid,
      datePaid: r.datePaid ? r.datePaid.toISOString().slice(0, 10) : null,
      comments: r.comments,
      outstanding: computed.outstanding,
      outstandingDays: computed.outstandingDays,
      status: computed.status,
    }
  })

  return NextResponse.json({ rows })
}
