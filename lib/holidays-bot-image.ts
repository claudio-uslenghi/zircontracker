// Imagen del Holidays Bot: SVG armado a mano sobre el template de acuarela
// (assets/holidays-bot/template.jpg) y rasterizado con resvg-wasm.
//
// Por qué no next/og ni satori:
// - Next 14.2.35 intercepta CUALQUIER import de @vercel/og y lo redirige a su
//   copia bundleada, que en Windows arma una URL file:// rota al cargar su
//   fuente default (TypeError: Invalid URL) — reproducido en dev y en build.
// - satori@0.0.46 (la única versión que bundlea bien acá) usa SOLO la primera
//   fuente del array para todo el árbol, y maneja mal flex anidado. Esta
//   imagen necesita tres tipografías y coordenadas exactas sobre el template.
//
// Por eso el texto se convierte a paths con opentype.js (sin fuentes
// instaladas en el rasterizador) y resvg solo dibuja formas e imágenes.
import { readFileSync } from 'fs'
import { join } from 'path'
import * as opentype from 'opentype.js'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import { NAME_EN_BY_NAME } from '@/lib/countries'
import type { CountryHolidaysGroup, HolidaysBotMonthData } from '@/lib/holidays-bot-data'

const W = 1024
const H = 1536
const NAVY = '#0c2a5c'
const GREEN = '#1f6b35'
const GREEN_LIGHT = '#cddcc7'

const ASSETS_DIR = join(process.cwd(), 'assets', 'holidays-bot')

// initWasm solo puede llamarse una vez por instancia de resvg: la promesa
// vive en globalThis para sobrevivir a re-evaluaciones del módulo (hot reload
// en dev, rutas con copias separadas de esta lib).
const globalState = globalThis as unknown as { __holidaysBotResvgReady?: Promise<void> }
function ensureResvgWasm(): Promise<void> {
  if (!globalState.__holidaysBotResvgReady) {
    const wasmPath = join(process.cwd(), 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm')
    globalState.__holidaysBotResvgReady = initWasm(readFileSync(wasmPath)).catch((err) => {
      if (err instanceof Error && /already initialized/i.test(err.message)) return
      globalState.__holidaysBotResvgReady = undefined
      throw err
    })
  }
  return globalState.__holidaysBotResvgReady
}

// ── Assets (cacheados en memoria del proceso)

function loadFont(file: string): opentype.Font {
  const b = readFileSync(join(ASSETS_DIR, file))
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
}

let fonts: { serifBold: opentype.Font; script: opentype.Font; sans: opentype.Font; sansSemiBold: opentype.Font } | null = null
function getFonts() {
  if (!fonts) {
    fonts = {
      serifBold: loadFont('LibreBaskerville-Bold.ttf'),
      script: loadFont('GreatVibes-Regular.ttf'),
      sans: loadFont('Inter-Regular.ttf'),
      sansSemiBold: loadFont('Inter-SemiBold.ttf'),
    }
  }
  return fonts
}

let templateDataUri: string | null = null
function getTemplateDataUri() {
  if (!templateDataUri) {
    templateDataUri = `data:image/jpeg;base64,${readFileSync(join(ASSETS_DIR, 'template.jpg')).toString('base64')}`
  }
  return templateDataUri
}

// ── Texto → paths

// opentype.js: font.getPath/getAdvanceWidth pasan por el motor GSUB, que
// revienta con ciertos lookups ("substFormat: 2 is not yet supported"). Para
// texto latino alcanza con advance + kerning glifo por glifo.
function layout(font: opentype.Font, str: string, size: number, tracking = 0) {
  const scale = size / font.unitsPerEm
  // Caracteres que la fuente no tiene (emoji, otros alfabetos) saldrían como
  // cajas (.notdef): se reemplazan por '?'.
  const glyphs = Array.from(str).map((ch) => {
    const g = font.charToGlyph(ch)
    return g.index === 0 ? font.charToGlyph('?') : g
  })
  const placed: { glyph: opentype.Glyph; x: number }[] = []
  let x = 0
  glyphs.forEach((glyph, i) => {
    placed.push({ glyph, x })
    x += (glyph.advanceWidth || 0) * scale
    if (i < glyphs.length - 1) {
      let k = 0
      try {
        k = font.getKerningValue(glyph, glyphs[i + 1]) || 0
      } catch {
        k = 0
      }
      x += k * scale + (tracking / 1000) * size
    }
  })
  return { placed, width: x }
}

const textWidth = (font: opentype.Font, str: string, size: number, tracking = 0) => layout(font, str, size, tracking).width

// Serialización propia en vez de Path.toPathData(): su salida (sin 'Z' entre
// contornos) hace que resvg descarte contornos sueltos — se perdían los
// puntos de las "i" y glifos enteros según la posición. Con comandos
// absolutos y 'Z' explícito en cada contorno renderiza todo bien.
function contoursToD(path: opentype.Path): string {
  const f = (n: number) => n.toFixed(2)
  let out = ''
  let open = false
  for (const c of path.commands) {
    if (c.type === 'M') {
      if (open) out += 'Z'
      open = true
      out += `M${f(c.x)} ${f(c.y)}`
    } else if (c.type === 'L') out += `L${f(c.x)} ${f(c.y)}`
    else if (c.type === 'Q') out += `Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`
    else if (c.type === 'C') out += `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`
    else if (c.type === 'Z') {
      out += 'Z'
      open = false
    }
  }
  return open ? out + 'Z' : out
}

function textPath(
  font: opentype.Font,
  str: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  opts: { anchor?: 'start' | 'middle' | 'end'; tracking?: number } = {}
): string {
  const { anchor = 'start', tracking = 0 } = opts
  const { placed, width } = layout(font, str, size, tracking)
  const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x
  const d = placed.map(({ glyph, x: gx }) => contoursToD(glyph.getPath(x0 + gx, y, size))).join('')
  return d ? `<path d="${d}" fill="${fill}"/>` : ''
}

function wrapText(font: opentype.Font, str: string, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (let word of str.split(/\s+/).filter(Boolean)) {
    // Una palabra más ancha que la columna se parte por caracteres.
    while (textWidth(font, word, size) > maxWidth && word.length > 1) {
      let n = word.length - 1
      while (n > 1 && textWidth(font, word.slice(0, n), size) > maxWidth) n--
      if (cur) lines.push(cur)
      lines.push(word.slice(0, n))
      cur = ''
      word = word.slice(n)
    }
    const test = cur ? `${cur} ${word}` : word
    if (!cur || textWidth(font, test, size) <= maxWidth) cur = test
    else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur) lines.push(cur)
  return lines
}

// ── Banderas

const FLAG_TIMEOUT_MS = 4000

// Solo se cachean las banderas que bajaron bien (los fallos se reintentan).
const flagCache = new Map<string, string>()

async function fetchFlagDataUri(code: string): Promise<string | null> {
  const cached = flagCache.get(code)
  if (cached) return cached
  try {
    const res = await fetch(`https://flagcdn.com/w160/${code}.png`, { signal: AbortSignal.timeout(FLAG_TIMEOUT_MS) })
    if (!res.ok) return null
    if (!res.headers.get('content-type')?.startsWith('image/png')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const uri = `data:image/png;base64,${buf.toString('base64')}`
    flagCache.set(code, uri)
    return uri
  } catch {
    return null
  }
}

// ── Globo (placeholder de país sin bandera + ícono de "Holidays:")

function globe(id: string, cx: number, cy: number, r: number): string {
  const p = (n: number) => (n * r).toFixed(2)
  return `<g>
    <defs>
      <radialGradient id="gb${id}" cx="35%" cy="30%"><stop offset="0" stop-color="#6fb7f2"/><stop offset="1" stop-color="#1b5fb4"/></radialGradient>
      <clipPath id="gc${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#gb${id})"/>
    <g clip-path="url(#gc${id})" fill="#6aa84f">
      <path d="M${cx - r * 0.55} ${cy - r * 0.6} q ${p(0.5)} ${p(-0.25)} ${p(0.75)} ${p(0.1)} q ${p(0.1)} ${p(0.5)} ${p(-0.35)} ${p(0.75)} q ${p(-0.5)} ${p(-0.1)} ${p(-0.4)} ${p(-0.85)} z"/>
      <path d="M${cx + r * 0.1} ${cy + r * 0.1} q ${p(0.6)} ${p(-0.2)} ${p(0.75)} ${p(0.25)} q ${p(-0.1)} ${p(0.55)} ${p(-0.55)} ${p(0.65)} q ${p(-0.35)} ${p(-0.35)} ${p(-0.2)} ${p(-0.9)} z"/>
    </g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1b4f94" stroke-width="1.5" opacity="0.5"/>
  </g>`
}

// ── Composición

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAYS_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// Zonas de la lista de países. La primera es la columna izquierda del
// template; si hay muchos países, el resto sigue en la segunda, debajo del
// calendario (a la derecha de las hojas decorativas).
const LIST_LEFT = 40
const LIST_TOP = 490
const LIST_COLUMNS = [
  { left: LIST_LEFT, right: 450, top: LIST_TOP, bottom: 1150, textW: 270 },
  { left: 480, right: 1000, top: 1115, bottom: 1480, textW: 440 },
]
const MIN_SCALE = 0.5

// Calendario (caja a la derecha del template).
const CAL = { x: 470, y: 483, w: 520, h: 589 }
const CAL_COL_X = (i: number) => 508 + 72.9 * i
const CAL_FIRST_ROW_Y = 594
const CAL_LAST_ROW_Y = 1030

function buildTitle(year: number, monthEn: string): string {
  const { serifBold, script } = getFonts()
  const gap = 22
  const maxTotal = 905
  let sHello = 100
  let sMonth = 190
  let sYear = 76
  const total = () =>
    textWidth(serifBold, 'Hello', sHello) + gap + textWidth(script, monthEn, sMonth) + gap + textWidth(serifBold, String(year), sYear)
  if (total() > maxTotal) {
    const k = maxTotal / total()
    sHello *= k
    sMonth *= k
    sYear *= k
  }
  let x = (W - total()) / 2
  let out = textPath(serifBold, 'Hello', x, 250, sHello, NAVY)
  x += textWidth(serifBold, 'Hello', sHello) + gap
  out += textPath(script, monthEn, x, 262, sMonth, GREEN)
  x += textWidth(script, monthEn, sMonth) + gap
  out += textPath(serifBold, String(year), x, 250, sYear, NAVY)
  return out
}

function buildCalendar(data: HolidaysBotMonthData, monthEn: string): string {
  const { sans, sansSemiBold } = getFonts()
  let out = `<rect x="${CAL.x}" y="${CAL.y}" width="${CAL.w}" height="${CAL.h}" rx="28" fill="none" stroke="${GREEN}" stroke-width="2"/>`

  const title = `${monthEn.toUpperCase()} ${data.year}`
  const tw = textWidth(sansSemiBold, title, 28, 20)
  const cx = CAL.x + CAL.w / 2
  out += textPath(sansSemiBold, title, cx, 455, 28, GREEN, { anchor: 'middle', tracking: 20 })
  out += `<line x1="487" y1="443" x2="${cx - tw / 2 - 18}" y2="443" stroke="${GREEN}" stroke-width="1.5"/>`
  out += `<line x1="${cx + tw / 2 + 18}" y1="443" x2="975" y2="443" stroke="${GREEN}" stroke-width="1.5"/>`

  WEEKDAYS_EN.forEach((d, i) => {
    out += textPath(sansSemiBold, d, CAL_COL_X(i), 526, 20, NAVY, { anchor: 'middle', tracking: 10 })
  })
  out += `<line x1="487" y1="548" x2="975" y2="548" stroke="${GREEN}" stroke-width="1.5"/>`

  const first = new Date(Date.UTC(data.year, data.month - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(data.year, data.month, 0)).getUTCDate()
  const rows = Math.ceil((first + daysInMonth) / 7)
  const rowStep = rows <= 5 ? 104.5 : (CAL_LAST_ROW_Y - CAL_FIRST_ROW_Y) / (rows - 1)
  const highlighted = new Set(data.countries.flatMap((c) => c.holidays.map((h) => Number(h.date.slice(8, 10)))))

  for (let day = 1; day <= daysInMonth; day++) {
    const idx = first + day - 1
    const x = CAL_COL_X(idx % 7)
    const y = CAL_FIRST_ROW_Y + Math.floor(idx / 7) * rowStep
    if (highlighted.has(day)) out += `<circle cx="${x}" cy="${y}" r="28" fill="${GREEN_LIGHT}"/>`
    out += textPath(sans, String(day), x, y + 10, 27, NAVY, { anchor: 'middle' })
  }
  return out
}

function buildCountryList(data: HolidaysBotMonthData, flags: Map<string, string | null>): string {
  const { serifBold, sans } = getFonts()
  const { month } = data

  if (data.countries.length === 0) {
    return textPath(sans, 'No holidays this month.', LIST_LEFT + 4, LIST_TOP + 40, 26, NAVY)
  }

  const holidayLabel = (iso: string, name: string) => {
    const date = `${Number(iso.slice(8, 10))}/${month}`
    return name.trim() ? `${date} – ${name.trim()}` : date
  }
  const wrapEntry = (country: CountryHolidaysGroup, s: number, col: number) =>
    country.holidays.map((h) => wrapText(sans, holidayLabel(h.date, h.name), 25 * s, LIST_COLUMNS[col].textW))
  const entryHeight = (country: CountryHolidaysGroup, holidays: string[][], s: number) =>
    80 * s + holidays.reduce((a, l) => a + l.length, 0) * 31 * s + (country.holidays.length - 1) * 6 * s

  // Reparte los países en LIST_COLUMNS: llena la primera hasta su borde
  // inferior y sigue en la siguiente. fits=false si ni así entra.
  const place = (s: number) => {
    const placed: { country: CountryHolidaysGroup; holidays: string[][]; col: number; y: number }[] = []
    let col = 0
    let y = LIST_COLUMNS[0].top
    for (const country of data.countries) {
      let holidays = wrapEntry(country, s, col)
      let height = entryHeight(country, holidays, s)
      if (y + height > LIST_COLUMNS[col].bottom && col < LIST_COLUMNS.length - 1 && y > LIST_COLUMNS[col].top) {
        col++
        y = LIST_COLUMNS[col].top
        holidays = wrapEntry(country, s, col)
        height = entryHeight(country, holidays, s)
      }
      if (y + height > LIST_COLUMNS[col].bottom) return { placed, fits: false }
      placed.push({ country, holidays, col, y })
      y += height + 48 * s
    }
    return { placed, fits: true }
  }

  // Si no entra, se achica todo proporcionalmente hasta MIN_SCALE.
  let scale = 1
  let result = place(scale)
  while (!result.fits && scale > MIN_SCALE) {
    scale = Math.max(MIN_SCALE, scale - 0.04)
    result = place(scale)
  }
  // A MIN_SCALE sin lugar: se dibuja lo que entró (nunca pisa las hojas).

  let out = ''
  result.placed.forEach(({ country, holidays, col, y }, idx) => {
    const left = LIST_COLUMNS[col].left
    const fw = 90 * scale
    const fh = 60 * scale
    const flag = flags.get(country.country) ?? null
    if (flag) {
      out += `<rect x="${left + 2}" y="${y + 4}" width="${fw}" height="${fh}" rx="6" fill="#000" opacity="0.18" filter="url(#blur)"/>`
      out += `<clipPath id="fc${idx}"><rect x="${left}" y="${y}" width="${fw}" height="${fh}" rx="6"/></clipPath>`
      out += `<image x="${left}" y="${y}" width="${fw}" height="${fh}" preserveAspectRatio="none" clip-path="url(#fc${idx})" xlink:href="${flag}"/>`
      out += `<rect x="${left}" y="${y}" width="${fw}" height="${fh}" rx="6" fill="none" stroke="#000" stroke-opacity="0.15"/>`
    } else {
      out += globe(`c${idx}`, left + fw / 2, y + fh / 2, Math.min(fw, fh) / 2)
    }

    // El nombre se achica si no entra antes del borde de la columna (ej.
    // "Dominican Republic" pisaba el calendario).
    const displayName = NAME_EN_BY_NAME[country.country] ?? country.country
    const nameX = left + fw + 30 * scale
    let nameSize = 36 * scale
    const nameMax = LIST_COLUMNS[col].right - nameX
    const nameW = textWidth(serifBold, displayName, nameSize)
    if (nameW > nameMax) nameSize *= nameMax / nameW
    out += textPath(serifBold, displayName, nameX, y + fh / 2 + 13 * scale, nameSize, GREEN)

    let ly = y + fh + 26 * scale
    for (const lines of holidays) {
      lines.forEach((line, i) => {
        if (i === 0) out += `<circle cx="${left + 12}" cy="${ly - 8 * scale}" r="${3.6 * scale}" fill="${NAVY}"/>`
        out += textPath(sans, line, left + 31, ly, 25 * scale, NAVY)
        ly += 31 * scale
      })
      ly += 6 * scale
    }
  })
  return out
}

async function buildSvg(data: HolidaysBotMonthData): Promise<string> {
  const { serifBold } = getFonts()
  const monthEn = MONTH_NAMES_EN[data.month - 1]

  const flagEntries = await Promise.all(
    data.countries.map(async (c) => [c.country, c.hasKnownFlag ? await fetchFlagDataUri(c.code) : null] as const)
  )
  const flags = new Map(flagEntries)

  const body =
    `<image x="0" y="0" width="${W}" height="${H}" xlink:href="${getTemplateDataUri()}"/>` +
    buildTitle(data.year, monthEn) +
    globe('h', 88, 377, 36) +
    textPath(serifBold, 'Holidays:', 155, 395, 40, NAVY) +
    buildCalendar(data, monthEn) +
    buildCountryList(data, flags)

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter></defs>
  ${body}</svg>`
}

// Devuelve el PNG ya codificado.
export async function renderHolidaysBotImagePng(data: HolidaysBotMonthData): Promise<Uint8Array> {
  await ensureResvgWasm()
  const svg = await buildSvg(data)
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render()
}

export async function renderHolidaysBotImage(data: HolidaysBotMonthData): Promise<Response> {
  const png = await renderHolidaysBotImagePng(data)
  return new Response(new Uint8Array(png), {
    headers: { 'content-type': 'image/png', 'cache-control': 'no-cache, no-store' },
  })
}
