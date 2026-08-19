export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const projects = await prisma.project.findMany()
  // SQLite's default ORDER BY is byte/ASCII collation (all uppercase before
  // any lowercase), which doesn't match human alphabetical order for mixed-
  // case names — sort in JS with localeCompare instead.
  projects.sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json(projects)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const project = await prisma.project.create({
    data: {
      name: body.name,
      color: body.color,
      status: body.status,
      priority: body.priority,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      estimatedHours: Number(body.estimatedHours),
      costPerHour: Number(body.costPerHour ?? 0),
      budgetHours: body.budgetHours != null ? Number(body.budgetHours) : null,
      projectType: body.projectType ?? 'fixed',
      notes: body.notes ?? '',
    },
  })
  return NextResponse.json(project, { status: 201 })
}
