export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Read-only aggregate — no requireAdmin(), this page is visible to every
// authenticated role regardless of the PagePermission matrix (see middleware.ts).
export async function GET() {
  const [userCount, projectCount, holidays] = await Promise.all([
    prisma.user.count({ where: { active: true } }),
    prisma.project.count(),
    prisma.countryHoliday.findMany({
      where: { date: { gte: new Date() } },
      orderBy: { date: 'asc' },
      take: 8,
    }),
  ])

  return NextResponse.json({ userCount, projectCount, upcomingHolidays: holidays })
}
