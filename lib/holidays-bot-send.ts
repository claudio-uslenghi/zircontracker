import { prisma } from '@/lib/prisma'
import {
  getHolidaysBotMonthData,
  buildHolidaysBotText,
  filterHolidaysBotCountries,
  type HolidaysBotMonthData,
} from '@/lib/holidays-bot-data'
import { renderHolidaysBotImagePng } from '@/lib/holidays-bot-image'
import { postImageToSlack, postToSlackWebhook } from '@/lib/slack'

export const SOURCE = 'holidays-bot'
export type Trigger = 'cron' | 'manual'

export interface HolidaysBotOutcome {
  dryRun: boolean
  skipped: boolean // no hubo feriados ese mes para los países incluidos
  data: HolidaysBotMonthData // siempre el set completo del mes, para pintar los checkboxes
  text: string // refleja la selección efectiva (ver sentCountries)
  sentCountries: string[] // qué países se usaron para armar text/imagen esta vez
  slackTs?: string
  slackPermalink?: string
}

async function recordRun(trigger: Trigger, data: HolidaysBotMonthData, ok: boolean, details: string) {
  const countriesCount = data.countries.length
  const holidaysCount = data.countries.reduce((s, c) => s + c.holidays.length, 0)
  await prisma.syncRun.create({
    data: {
      source: SOURCE,
      trigger,
      ok,
      created: countriesCount,
      updated: holidaysCount,
      errorCount: ok ? 0 : 1,
      details,
    },
  })
}

// Decide qué países se usan si el caller no mandó una selección explícita:
// el cron (nadie revisa el envío automático) y cualquier envío real sin
// selección explícita se quedan con el filtro de siempre (solo países con
// recursos hoy); el preview sin selección explícita muestra todo, porque
// ahí el default confirmado es "todo marcado, el admin destilda".
function defaultCountries(data: HolidaysBotMonthData, dryRun: boolean): string[] {
  if (dryRun) return data.countries.map((c) => c.country)
  return data.countries.filter((c) => c.hasResource).map((c) => c.country)
}

// Núcleo compartido por el cron, el botón "Enviar ahora" y el preview.
// dryRun=true nunca toca Slack ni registra una corrida (mismo criterio que
// vacations/sync): solo arma el texto + genera la imagen para mostrar.
export async function runHolidaysBot(opts: {
  year: number
  month: number
  trigger: Trigger
  dryRun: boolean
  selectedCountries?: string[]
}): Promise<HolidaysBotOutcome> {
  const data = await getHolidaysBotMonthData(opts.year, opts.month)
  const effectiveCountries = opts.selectedCountries ?? defaultCountries(data, opts.dryRun)
  const filtered = filterHolidaysBotCountries(data, effectiveCountries)
  const text = buildHolidaysBotText(filtered)
  const skipped = filtered.countries.length === 0

  if (opts.dryRun) {
    return { dryRun: true, skipped, data, text, sentCountries: effectiveCountries }
  }

  if (skipped) {
    await recordRun(opts.trigger, filtered, true, 'sin feriados este mes para los países incluidos')
    return { dryRun: false, skipped: true, data, text, sentCountries: effectiveCountries }
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  const token = process.env.SLACK_BOT_TOKEN
  const channelId = process.env.SLACK_HOLIDAYS_CHANNEL_ID
  if (!webhookUrl && !token) {
    throw new Error('Falta configurar SLACK_WEBHOOK_URL o SLACK_BOT_TOKEN.')
  }

  try {
    let ts: string | undefined
    let permalink: string | undefined

    if (webhookUrl) {
      // El canal lo fija el webhook en sí (no es overrideable por request —
      // verificado contra docs.slack.dev), y la imagen tiene que salir de
      // una URL pública: Slack la descarga del lado de ellos, no funciona
      // contra localhost en desarrollo.
      //
      // NEXTAUTH_URL NO se usa acá a propósito, aunque esté seteada: en este
      // proyecto apunta a un dominio viejo (gantt-app.vercel.app, ya dado de
      // baja) en vez del dominio actual (zircon-tracker.vercel.app) —
      // confirmado en producción (el link posteado a Slack daba 404).
      // Es una env var para los callbacks de NextAuth, no para esto; usarla
      // acá fue el bug. VERCEL_PROJECT_PRODUCTION_URL es la que Vercel
      // mantiene automáticamente correcta en cada deploy, documentada
      // específicamente para "reliably generate links that point to
      // production such as OG-image URLs" — nuestro caso de uso exacto — así
      // que va primero. VERCEL_URL queda de último respaldo (preview
      // deployments sin alias de producción).
      const baseUrl =
        (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
        process.env.NEXTAUTH_URL ||
        ''
      if (!baseUrl) {
        throw new Error('Falta configurar VERCEL_PROJECT_PRODUCTION_URL (o NEXTAUTH_URL) para poder armar la URL pública de la imagen.')
      }
      // El nombre de archivo con extensión .png es obligatorio: Slack solo
      // unfurla imágenes cuya URL termina en una extensión reconocible
      // (png/jpg/jpeg/gif) — ver app/api/holidays-bot/image/[filename]/route.tsx.
      // La ruta la pega Slack sin sesión, así que la selección de países
      // viaja en la query string para que la imagen coincida con el texto.
      const countriesParam = encodeURIComponent(effectiveCountries.join(','))
      const imageUrl = `${baseUrl}/api/holidays-bot/image/${data.year}-${data.month}.png?countries=${countriesParam}`
      await postToSlackWebhook({ webhookUrl, text, imageUrl })
    } else if (token && channelId) {
      const png = await renderHolidaysBotImagePng(filtered)
      const filename = `holidays-${data.year}-${String(data.month).padStart(2, '0')}.png`
      const result = await postImageToSlack({ token, channelId, imageBuffer: png.buffer as ArrayBuffer, filename, text })
      ts = result.ts
      permalink = result.permalink
    } else {
      throw new Error('Falta configurar SLACK_HOLIDAYS_CHANNEL_ID junto con SLACK_BOT_TOKEN.')
    }

    await recordRun(opts.trigger, filtered, true, JSON.stringify({ countries: filtered.countries.map((c) => c.country) }))
    return { dryRun: false, skipped: false, data, text, sentCountries: effectiveCountries, slackTs: ts, slackPermalink: permalink }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error'
    await recordRun(opts.trigger, filtered, false, message)
    throw err
  }
}
