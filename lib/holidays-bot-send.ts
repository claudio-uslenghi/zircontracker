import { prisma } from '@/lib/prisma'
import { getHolidaysBotMonthData, buildHolidaysBotText, type HolidaysBotMonthData } from '@/lib/holidays-bot-data'
import { renderHolidaysBotImagePng } from '@/lib/holidays-bot-image'
import { postImageToSlack, postToSlackWebhook } from '@/lib/slack'

export const SOURCE = 'holidays-bot'
export type Trigger = 'cron' | 'manual'

export interface HolidaysBotOutcome {
  dryRun: boolean
  skipped: boolean // no hubo feriados ese mes para ningún país con recursos
  data: HolidaysBotMonthData
  text: string
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

// Núcleo compartido por el cron, el botón "Enviar ahora" y el preview.
// dryRun=true nunca toca Slack ni registra una corrida (mismo criterio que
// vacations/sync): solo arma el texto + genera la imagen para mostrar.
export async function runHolidaysBot(opts: {
  year: number
  month: number
  trigger: Trigger
  dryRun: boolean
}): Promise<HolidaysBotOutcome> {
  const data = await getHolidaysBotMonthData(opts.year, opts.month)
  const text = buildHolidaysBotText(data)
  const skipped = data.countries.length === 0

  if (opts.dryRun) {
    return { dryRun: true, skipped, data, text }
  }

  if (skipped) {
    await recordRun(opts.trigger, data, true, 'sin feriados este mes')
    return { dryRun: false, skipped: true, data, text }
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
      const baseUrl = process.env.NEXTAUTH_URL ?? ''
      const imageUrl = `${baseUrl}/api/holidays-bot/image?year=${data.year}&month=${data.month}`
      await postToSlackWebhook({
        webhookUrl,
        text,
        imageUrl,
        imageAlt: `Feriados de ${data.monthNameEs} ${data.year}`,
      })
    } else if (token && channelId) {
      const png = await renderHolidaysBotImagePng(data)
      const filename = `holidays-${data.year}-${String(data.month).padStart(2, '0')}.png`
      const result = await postImageToSlack({ token, channelId, imageBuffer: png.buffer as ArrayBuffer, filename, text })
      ts = result.ts
      permalink = result.permalink
    } else {
      throw new Error('Falta configurar SLACK_HOLIDAYS_CHANNEL_ID junto con SLACK_BOT_TOKEN.')
    }

    await recordRun(opts.trigger, data, true, JSON.stringify({ countries: data.countries.map((c) => c.country) }))
    return { dryRun: false, skipped: false, data, text, slackTs: ts, slackPermalink: permalink }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error'
    await recordRun(opts.trigger, data, false, message)
    throw err
  }
}
