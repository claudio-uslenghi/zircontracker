export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

// Partial update of a ClientInvoice record's own fields. Marking an invoice
// paid/partially-paid happens through .../payments instead (see
// app/api/invoices/[id]/payments/route.ts) — Paid isn't a field anymore,
// it's derived from the sum of InvoicePayment rows.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const id = Number(params.id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  const body = await req.json()
  const data: {
    billed?: number
    comments?: string
    customer?: string
    description?: string
  } = {}

  if (body.billed !== undefined) data.billed = Number(body.billed)
  if (body.comments !== undefined) data.comments = String(body.comments)
  if (body.customer !== undefined) data.customer = String(body.customer).trim()
  if (body.description !== undefined) data.description = String(body.description)

  try {
    const record = await prisma.clientInvoice.update({ where: { id }, data })
    return NextResponse.json(record)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
