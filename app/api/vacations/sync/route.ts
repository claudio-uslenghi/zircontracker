export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { SheetFormatError } from '@/lib/vacation-sync'
import { SYNC_SOURCE, fetchSheetRows, recordRun, runVacationSync } from '@/lib/vacation-sync-run'

async function adminOr403() {
  try {
    await requireAdmin()
    return null
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}

// Latest real run (cron or manual) — shown as "Última sincronización" in /holidays.
export async function GET() {
  const denied = await adminOr403()
  if (denied) return denied
  const last = await prisma.syncRun.findFirst({ where: { source: SYNC_SOURCE }, orderBy: { ranAt: 'desc' } })
  return NextResponse.json(last)
}

// Body: { dryRun?: boolean (default true), allowLargeDeletes?: boolean }.
// The admin button always previews first (dryRun) and only then applies.
export async function POST(req: NextRequest) {
  const denied = await adminOr403()
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const dryRun = body.dryRun !== false
  try {
    const rows = await fetchSheetRows()
    const outcome = await runVacationSync({
      rows,
      dryRun,
      trigger: 'manual',
      allowLargeDeletes: body.allowLargeDeletes === true,
    })
    return NextResponse.json(outcome)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error'
    if (!dryRun) await recordRun('manual', null, false, message).catch(() => undefined)
    const status = err instanceof SheetFormatError ? 502 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
