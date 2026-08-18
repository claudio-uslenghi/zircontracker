export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, requireAdmin } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const projectId = searchParams.get('projectId')

  const tasks = await prisma.task.findMany({
    where: projectId ? { projectId: Number(projectId) } : undefined,
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(tasks)
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const { projectId, name } = await req.json()

    if (!projectId || !name?.trim()) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
    }

    const task = await prisma.task.create({
      data: { projectId: Number(projectId), name: name.trim() },
    })
    return NextResponse.json(task, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
