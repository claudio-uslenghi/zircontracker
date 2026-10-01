export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { movePivotItem } from '@/lib/pivot-order'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = Number(params.id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  const body = await req.json()
  const direction = body.direction === 'up' ? 'up' : body.direction === 'down' ? 'down' : null
  if (!direction) return NextResponse.json({ error: 'direction debe ser up o down' }, { status: 400 })

  await movePivotItem('resource', id, direction)
  return NextResponse.json({ ok: true })
}
