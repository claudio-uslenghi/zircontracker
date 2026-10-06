// Dos formas de postear, según qué haya configurado el usuario:
//
// 1) SLACK_WEBHOOK_URL (Incoming Webhook) — la que está en uso hoy. Un
//    webhook NO puede subir archivos, solo texto/blocks; el canal queda fijo
//    al que se eligió cuando se creó el webhook (no es overrideable por
//    request — verificado contra docs.slack.dev). Para mostrar la imagen se
//    usa un block "image" con una URL pública (`image_url`) que Slack
//    descarga — por eso la imagen tiene que salir de una ruta accesible
//    desde internet (no funciona contra localhost; recién se ve completa una
//    vez deployado). Se ve como una imagen incrustada en el mensaje, no como
//    un archivo adjunto con nombre de archivo (eso solo lo da la opción 2).
//
// 2) SLACK_BOT_TOKEN (Bot Token, scopes chat:write + files:write) — subida
//    real de archivo, igual al mensaje de referencia de Anabella
//    ("Pastel October 2026 Holiday Calendar.png" como adjunto). files.upload
//    quedó deprecado y sunseteado (12/nov/2025); el flujo vigente verificado
//    contra la documentación oficial es en 3 pasos: getUploadURLExternal →
//    POST de los bytes a esa URL (sin auth) → completeUploadExternal, que
//    con channel_id + initial_comment postea texto + imagen como UN solo
//    mensaje. Queda implementado por si en el futuro se arma la Slack App
//    con bot token en vez del webhook.

const SLACK_API = 'https://slack.com/api'

class SlackApiError extends Error {}

async function callSlackApi(method: string, token: string, body: Record<string, unknown>) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new SlackApiError(`Slack ${method} falló: ${data.error ?? res.status}`)
  }
  return data
}

export async function postImageToSlack(opts: {
  token: string
  channelId: string
  imageBuffer: ArrayBuffer
  filename: string
  text: string
}): Promise<{ ts: string; permalink?: string }> {
  const { token, channelId, imageBuffer, filename, text } = opts

  const { upload_url, file_id } = await callSlackApi('files.getUploadURLExternal', token, {
    filename,
    length: imageBuffer.byteLength,
  })

  const uploadRes = await fetch(upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: imageBuffer,
  })
  if (!uploadRes.ok) {
    throw new SlackApiError(`Subida del archivo a Slack falló: HTTP ${uploadRes.status}`)
  }

  const completed = await callSlackApi('files.completeUploadExternal', token, {
    files: [{ id: file_id, title: filename }],
    channel_id: channelId,
    initial_comment: text,
  })

  const file = completed.files?.[0]
  return { ts: file?.shares?.public?.[channelId]?.[0]?.ts ?? '', permalink: file?.permalink }
}

// Incoming Webhook: texto plano con la URL de la imagen al final, sin
// Block Kit. Se probó un block top-level de tipo "image" primero y Slack
// lo rechazaba con "400 invalid_blocks" en todos los casos — la doc oficial
// de Incoming Webhooks solo muestra "image" como accessory DENTRO de un
// section block, nunca como block independiente; no está confirmado que el
// tipo top-level esté soportado en este endpoint. En vez de perseguir esa
// combinación, se usa el unfurl automático de Slack: cualquier URL de
// imagen (.png/.jpg/...) que aparezca en el texto del mensaje se expande
// sola como preview incrustado (verificado contra la documentación
// oficial — es el comportamiento default, unfurl_media no hace falta
// pasarlo explícito salvo para desactivarlo). El canal lo decide el
// webhook mismo, no este payload.
export async function postToSlackWebhook(opts: { webhookUrl: string; text: string; imageUrl: string }) {
  const res = await fetch(opts.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `${opts.text}\n\n${opts.imageUrl}`,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new SlackApiError(`Webhook de Slack falló: HTTP ${res.status} ${body}`)
  }
}
