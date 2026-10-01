export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { setPivotHidden } from '@/lib/pivot-order'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = Number(params.id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  const body = await req.json()
  if (typeof body.hidden !== 'boolean') return NextResponse.json({ error: 'hidden debe ser boolean' }, { status: 400 })

  await setPivotHidden('project', id, body.hidden)
  return NextResponse.json({ ok: true })
}
