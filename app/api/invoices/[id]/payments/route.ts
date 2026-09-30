export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

// Registers a partial (or full) payment against a ClientInvoice. Overpaying
// is allowed on purpose — Outstanding can go negative rather than blocking
// a real payment because of a rounding/surcharge difference elsewhere.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const invoiceId = Number(params.id)
  if (!Number.isInteger(invoiceId)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  const body = await req.json()
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'El monto tiene que ser mayor a 0' }, { status: 400 })
  }
  const date = body.date ? new Date(body.date) : new Date()
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })

  try {
    const payment = await prisma.invoicePayment.create({
      data: { invoiceId, amount, date, comment: String(body.comment ?? '') },
    })
    return NextResponse.json(payment, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
