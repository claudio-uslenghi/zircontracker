export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSelfOrAdmin } from '@/lib/auth'

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id)
    const vacation = await prisma.vacation.findUnique({ where: { id } })
    if (!vacation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await requireSelfOrAdmin(vacation.resourceId)
    await prisma.vacation.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
