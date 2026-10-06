export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { runHolidaysBot } from '@/lib/holidays-bot-send'

// Vercel Cron llama esto el día 1 de cada mes (ver vercel.json) con
// `Authorization: Bearer ${CRON_SECRET}`. Sin sesión de usuario acá —
// middleware.ts deja pasar /api/cron sin chequeo, este handler es el único
// gate. Mismo patrón que /api/cron/vacations-sync.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const sha = (v: string) => createHash('sha256').update(v).digest()
  const provided = req.headers.get('authorization') ?? ''
  return timingSafeEqual(sha(provided), sha(`Bearer ${secret}`))
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  try {
    const outcome = await runHolidaysBot({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      trigger: 'cron',
      dryRun: false,
    })
    console.log('[holidays-bot]', outcome.skipped ? 'sin feriados este mes' : `enviado, ${outcome.data.countries.length} país(es)`)
    return NextResponse.json({ ok: true, skipped: outcome.skipped })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error'
    console.error('[holidays-bot] failed:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
