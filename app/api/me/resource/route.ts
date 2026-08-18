export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireOwnResource } from '@/lib/auth'

export async function GET() {
  try {
    const resource = await requireOwnResource()
    return NextResponse.json(resource)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error'
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg === 'NoResource') {
      return NextResponse.json(
        { error: 'Tu usuario no está vinculado a ningún recurso. Pedile a un admin que le agregue tu email al recurso correspondiente.' },
        { status: 404 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
