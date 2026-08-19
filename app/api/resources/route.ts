export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const resources = await prisma.resource.findMany()
  // Same reasoning as /api/projects — SQLite's default collation is
  // byte/ASCII order, not human alphabetical, for mixed-case names.
  resources.sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json(resources)
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  let resource
  try {
    resource = await prisma.resource.create({
      data: {
        name: body.name,
        email: body.email?.trim() || null,
        country: body.country,
        color: body.color ?? '#4472C4',
        capacityH: Number(body.capacityH ?? 8),
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    if (msg.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Ya existe un recurso con ese nombre o email' }, { status: 409 })
    }
    throw err
  }

  // Auto-assign country holidays to the new resource
  const countryHolidays = await prisma.countryHoliday.findMany({
    where: { country: resource.country },
  })
  for (const ch of countryHolidays) {
    await prisma.$executeRaw`
      INSERT INTO "Holiday" (resourceId, date, name)
      VALUES (${resource.id}, ${ch.date.toISOString()}, ${ch.name})
      ON CONFLICT (resourceId, date) DO UPDATE SET name = excluded.name
    `
  }

  return NextResponse.json(resource, { status: 201 })
}
