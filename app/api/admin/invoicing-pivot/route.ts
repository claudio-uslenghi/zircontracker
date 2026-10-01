export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { listPivotItems } from '@/lib/pivot-order'

// Full Project/Resource lists (hidden + visible) for the wizard's step-1
// management screen — see SPEC.md "Wizard de facturación mensual".
export async function GET() {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [projects, resources] = await Promise.all([listPivotItems('project'), listPivotItems('resource')])
  return NextResponse.json({ projects, resources })
}
