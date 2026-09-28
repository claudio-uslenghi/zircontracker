export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

// Partial update of a ClientInvoice record. Only billed/paid/datePaid/
// comments/customer/description are ever user-edited — total/dateInv/month/
// blockId/company are fixed once the record exists (see SPEC.md).
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
    paid?: boolean
    datePaid?: Date | null
    comments?: string
    customer?: string
    description?: string
  } = {}

  if (body.billed !== undefined) data.billed = Number(body.billed)
  if (body.comments !== undefined) data.comments = String(body.comments)
  if (body.customer !== undefined) data.customer = String(body.customer).trim()
  if (body.description !== undefined) data.description = String(body.description)

  if (body.paid !== undefined) {
    const paid = Boolean(body.paid)
    data.paid = paid
    if (paid) {
      // Explicit datePaid wins; otherwise default to today when first marked paid.
      data.datePaid = body.datePaid ? new Date(body.datePaid) : new Date()
    } else {
      // Un-marking paid clears datePaid so Outstanding days resumes counting from today.
      data.datePaid = null
    }
  } else if (body.datePaid !== undefined) {
    data.datePaid = body.datePaid ? new Date(body.datePaid) : null
  }

  try {
    const record = await prisma.clientInvoice.update({ where: { id }, data })
    return NextResponse.json(record)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
