export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSelfOrAdmin } from '@/lib/auth'

export async function GET() {
  const vacations = await prisma.vacation.findMany({
    include: { resource: true },
    orderBy: { startDate: 'asc' },
  })
  return NextResponse.json(vacations)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const resourceId = Number(body.resourceId)
    await requireSelfOrAdmin(resourceId)

    const vacation = await prisma.vacation.create({
      data: {
        resourceId,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        notes: body.notes ?? '',
      },
      include: { resource: true },
    })
    return NextResponse.json(vacation, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
