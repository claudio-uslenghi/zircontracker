export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getHolidaysBotMonthData } from '@/lib/holidays-bot-data'
import { renderHolidaysBotImage } from '@/lib/holidays-bot-image'

// Devuelve el PNG generado: para el preview en /holidays (admin) Y para que
// Slack lo descargue al postear vía Incoming Webhook (su image_url necesita
// una URL pública, sin sesión — por eso esta ruta no está gateada con
// requireAdmin). No expone nada sensible: son los mismos feriados por país
// que ya son de lectura pública dentro de la app.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const year = Number(searchParams.get('year'))
  const month = Number(searchParams.get('month'))
  const thisYear = new Date().getFullYear()
  if (!month || month < 1 || month > 12 || !year || year < thisYear - 1 || year > thisYear + 5) {
    return NextResponse.json({ error: 'year/month inválidos' }, { status: 400 })
  }

  const data = await getHolidaysBotMonthData(year, month)
  return renderHolidaysBotImage(data)
}
