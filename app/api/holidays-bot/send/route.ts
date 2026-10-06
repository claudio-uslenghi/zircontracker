export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { SOURCE, runHolidaysBot } from '@/lib/holidays-bot-send'

async function adminOr403() {
  try {
    await requireAdmin()
    return null
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}

// Última corrida real (cron o manual) — "Último envío" en /holidays.
export async function GET() {
  const denied = await adminOr403()
  if (denied) return denied
  const last = await prisma.syncRun.findFirst({ where: { source: SOURCE }, orderBy: { ranAt: 'desc' } })
  return NextResponse.json(last)
}

// Body: { year?, month?, dryRun? (default true), selectedCountries?: string[] }.
// El botón de preview en la UI siempre manda dryRun:true primero; "Enviar
// ahora" manda dryRun:false. selectedCountries es la selección por checkbox
// del admin (todos los países del mes marcados por defecto) — sin ella, el
// envío real cae al filtro de siempre (solo países con recursos hoy).
export async function POST(req: NextRequest) {
  const denied = await adminOr403()
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const now = new Date()
  const year = Number(body.year) || now.getFullYear()
  const month = Number(body.month) || now.getMonth() + 1
  const dryRun = body.dryRun !== false
  const selectedCountries = Array.isArray(body.selectedCountries)
    ? body.selectedCountries.filter((c: unknown) => typeof c === 'string')
    : undefined

  try {
    const outcome = await runHolidaysBot({ year, month, trigger: 'manual', dryRun, selectedCountries })
    return NextResponse.json(outcome)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
