export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { fetchSheetRows, recordRun, runVacationSync } from '@/lib/vacation-sync-run'

// Vercel Cron calls this daily (see vercel.json) with
// `Authorization: Bearer ${CRON_SECRET}`. There is no user session here, so the
// middleware lets /api/cron through and this handler is the only gate.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // never open by default when the secret is missing
  const sha = (v: string) => createHash('sha256').update(v).digest()
  const provided = req.headers.get('authorization') ?? ''
  return timingSafeEqual(sha(provided), sha(`Bearer ${secret}`))
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await fetchSheetRows()
    const outcome = await runVacationSync({ rows, dryRun: false, trigger: 'cron' })
    // Counts only: emails and names stay out of the function logs.
    console.log('[vacations-sync]', JSON.stringify(outcome.counts), outcome.deleteBlocked ? 'deletes-held-back' : '')
    return NextResponse.json({ ok: true, counts: outcome.counts, deleteBlocked: outcome.deleteBlocked })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error'
    console.error('[vacations-sync] failed:', message)
    await recordRun('cron', null, false, message).catch(() => undefined)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
