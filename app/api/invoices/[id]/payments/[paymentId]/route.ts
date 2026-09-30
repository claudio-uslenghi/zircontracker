export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; paymentId: string } }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const paymentId = Number(params.paymentId)
  if (!Number.isInteger(paymentId)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  try {
    await prisma.invoicePayment.delete({ where: { id: paymentId } })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
