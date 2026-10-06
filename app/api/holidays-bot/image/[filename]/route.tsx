export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getHolidaysBotMonthData } from '@/lib/holidays-bot-data'
import { renderHolidaysBotImage } from '@/lib/holidays-bot-image'

// Devuelve el PNG generado: para el preview en /holidays (admin) Y para que
// Slack lo descargue al postear vía Incoming Webhook. No está gateada con
// requireAdmin porque Slack no manda cookies de sesión — no expone nada
// sensible, son los mismos feriados por país que ya son de lectura pública
// dentro de la app.
//
// El nombre de archivo (no query params) es a propósito: el block "image"
// de Slack valida la extensión de la URL (png/jpg/jpeg/gif) antes de
// intentar descargarla — una URL tipo ?year=&month= sin extensión
// reconocible la rechaza con "400 invalid_blocks" aunque sea pública y
// resuelva bien (confirmado contra producción).
export async function GET(_req: Request, { params }: { params: { filename: string } }) {
  const match = params.filename.match(/^(\d{4})-(\d{1,2})\.png$/)
  if (!match) {
    return NextResponse.json({ error: 'Nombre de archivo inválido, esperado AAAA-M.png' }, { status: 400 })
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const thisYear = new Date().getFullYear()
  if (month < 1 || month > 12 || year < thisYear - 1 || year > thisYear + 5) {
    return NextResponse.json({ error: 'year/month inválidos' }, { status: 400 })
  }

  const data = await getHolidaysBotMonthData(year, month)
  return renderHolidaysBotImage(data)
}
