export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin()
    const { name, active } = await req.json()

    if (name !== undefined) {
      const trimmed = String(name).trim()
      const current = await prisma.task.findUnique({ where: { id: Number(params.id) }, select: { projectId: true } })
      if (current) {
        const siblings = await prisma.task.findMany({
          where: { projectId: current.projectId, id: { not: Number(params.id) } },
          select: { name: true },
        })
        if (siblings.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
          return NextResponse.json({ error: `Ya existe una tarea llamada "${trimmed}" en este proyecto` }, { status: 409 })
        }
      }
    }

    const task = await prisma.task.update({
      where: { id: Number(params.id) },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(active !== undefined ? { active: Boolean(active) } : {}),
      },
    })
    return NextResponse.json(task)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return NextResponse.json({ error: 'Ya existe una tarea con ese nombre en este proyecto' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin()
    await prisma.task.delete({ where: { id: Number(params.id) } })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    // FK violation: this task still has time entries pointing at it. Report
    // the count so the admin knows to reassign/merge those hours into
    // another task before retrying, instead of a raw Prisma stack trace.
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2003') {
      const count = await prisma.timeEntry.count({ where: { taskId: Number(params.id) } })
      return NextResponse.json(
        { error: `No se puede borrar: tiene ${count} hora${count !== 1 ? 's' : ''} cargada${count !== 1 ? 's' : ''}. Reasigná esas horas a otra tarea antes de borrarla.` },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
