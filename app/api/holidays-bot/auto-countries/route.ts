export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { COUNTRIES, canonicalCountryName } from '@/lib/countries'
import { getAutoCountryRows, setAutoCountries } from '@/lib/holidays-bot-auto'

async function adminOr403() {
  try {
    await requireAdmin()
    return null
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}

// El detalle técnico (errores de Prisma, rutas) va al log, no a la UI.
function serverError(context: string, err: unknown) {
  console.error(`[holidays-bot] auto-countries ${context}:`, err)
  return NextResponse.json({ error: 'No se pudo completar la operación. Probá de nuevo o revisá los logs.' }, { status: 500 })
}

// Países del envío automático del Holidays Bot (cron del día 1). Solo admin.
export async function GET() {
  const denied = await adminOr403()
  if (denied) return denied
  try {
    return NextResponse.json({ countries: await getAutoCountryRows() })
  } catch (err) {
    return serverError('GET', err)
  }
}

// Body: { countries: string[] } — reemplaza la lista completa. Cada nombre
// tiene que ser un país conocido (los de lib/countries.ts o alguno con
// feriados cargados); se acepta sin importar mayúsculas y se guarda con su
// nombre canónico.
export async function PUT(req: NextRequest) {
  const denied = await adminOr403()
  if (denied) return denied

  const body = await req.json().catch(() => null)
  const raw: unknown = body?.countries
  if (!Array.isArray(raw) || raw.length > 100 || raw.some((c) => typeof c !== 'string' || !c.trim() || c.length > 100)) {
    return NextResponse.json({ error: 'countries debe ser una lista de nombres de país' }, { status: 400 })
  }

  try {
    const known = new Map<string, string>()
    for (const name of COUNTRIES.map((c) => c.name).concat((await getAutoCountryRows()).map((r) => r.country))) {
      known.set(name.toLowerCase(), name)
    }
    const resolved: string[] = []
    const unknown: string[] = []
    for (const name of raw as string[]) {
      const match = known.get(canonicalCountryName(name.trim()).toLowerCase())
      if (match) resolved.push(match)
      else unknown.push(name)
    }
    if (unknown.length) {
      return NextResponse.json({ error: `País desconocido: ${unknown.slice(0, 3).join(', ')}` }, { status: 400 })
    }

    await setAutoCountries(resolved)
    return NextResponse.json({ countries: await getAutoCountryRows() })
  } catch (err) {
    return serverError('PUT', err)
  }
}
