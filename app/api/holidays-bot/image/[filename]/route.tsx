export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getHolidaysBotMonthData, filterHolidaysBotCountries } from '@/lib/holidays-bot-data'
import { renderHolidaysBotImage } from '@/lib/holidays-bot-image'

// Devuelve el PNG generado: para el preview en /feriados (admin) Y para que
// Slack lo descargue al hacer unfurl del link posteado. No está gateada con
// requireAdmin porque Slack no manda cookies de sesión — no expone nada
// sensible, son los mismos feriados por país que ya son de lectura pública
// dentro de la app.
//
// El nombre de archivo con extensión .png (en vez de todo por query param)
// viene de un intento anterior con un block "image" de Slack, que sí
// validaba la extensión de la URL — ya no se usa ese mecanismo (ver
// lib/slack.ts), pero se mantiene el formato porque no hay motivo para
// cambiarlo. `?countries=` sí es query param: es la selección de países que
// el admin tildó en el preview, para que la imagen coincida con el texto
// del mensaje real (sin esto, Slack descargaría siempre TODOS los países
// del mes, ignorando lo que se destildó).
export async function GET(req: Request, { params }: { params: { filename: string } }) {
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
  const countriesParam = new URL(req.url).searchParams.get('countries')
  const selected = countriesParam === null ? null : countriesParam.split(',').filter(Boolean)
  return renderHolidaysBotImage(filterHolidaysBotCountries(data, selected))
}
