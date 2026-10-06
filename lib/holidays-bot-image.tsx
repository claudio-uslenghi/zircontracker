// Ni next/og ni un import directo de @vercel/og sirven acá: Next 14.2.35
// intercepta CUALQUIER import con ese specifier (incluso instalando
// @vercel/og aparte) y lo redirige a su propia copia bundleada
// (next/dist/compiled/@vercel/og), que tiene un bug real en Windows —
// intenta cargar su fuente default con un join de path que arma una URL
// file:// rota (".\file:\C:\...\noto-sans-v27-latin-regular.ttf",
// TypeError: Invalid URL), reproducido incluso pasando fuentes propias.
// Confirmado con ambos imports (next/og y @vercel/og), en dev y en build de
// producción corridos localmente en Windows — mismo stack trace exacto en
// los tres casos, siempre resuelto por next/dist/server/og/image-response.js.
//
// Workaround: manejar satori + @resvg/resvg-wasm directo (son las piezas
// que @vercel/og usa por dentro), sin pasar por el wrapper de Next. satori
// sin pedir el entrypoint /wasm usa su motor de layout nativo en Node (no
// hace falta inicializar yoga a mano); resvg-wasm sí necesita init() una
// sola vez por proceso, con el .wasm resuelto por path de archivo (no por
// URL), que es justamente lo que rompía en el bug de arriba.
import { readFileSync } from 'fs'
import { join } from 'path'
import satori from 'satori'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import type { HolidaysBotMonthData } from '@/lib/holidays-bot-data'

let resvgReady: Promise<void> | null = null
function ensureResvgWasm() {
  if (!resvgReady) {
    const wasmPath = join(process.cwd(), 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm')
    resvgReady = initWasm(readFileSync(wasmPath))
  }
  return resvgReady
}

const WIDTH = 1000
const HEIGHT = 1300
// Satori no soporta anchos en porcentaje de forma confiable en celdas de
// grilla — todo en píxeles fijos.
const CAL_WIDTH = 340
const CAL_PAD = 20
const CAL_CELL = Math.floor((CAL_WIDTH - CAL_PAD * 2) / 7)

const PASTEL_BG = '#f6f1e4'
const INK = '#2e4a3a'
const ACCENT = '#7a9b76'

// Google Fonts no sirve el binario directo — hay que pedir el CSS (que trae
// la URL real del .ttf/.woff) y después bajar ese archivo. Patrón estándar
// para usar fuentes de Google en Satori/@vercel-og. Cacheado en memoria del
// proceso (se reusa entre invocaciones del mismo contenedor serverless).
const fontCache = new Map<string, ArrayBuffer | null>()

async function getGoogleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${family}-${weight}`
  if (fontCache.has(key)) return fontCache.get(key)!

  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`
    const css = await fetch(cssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then((r) => r.text())
    const match = css.match(/src: url\(([^)]+)\) format\('(?:truetype|woff)'\)/)
    if (!match) {
      console.error('[holidays-bot] CSS de Google Fonts sin match esperado', family, weight, css.slice(0, 300))
      fontCache.set(key, null)
      return null
    }
    const fontRes = await fetch(match[1])
    const buf = await fontRes.arrayBuffer()
    fontCache.set(key, buf)
    return buf
  } catch (err) {
    // Sin la fuente, @vercel/og cae a su fuente por default — la imagen
    // sigue saliendo, solo con tipografía genérica en vez de manuscrita.
    console.error('[holidays-bot] no se pudo bajar la fuente', family, weight, err)
    fontCache.set(key, null)
    return null
  }
}

// satori@0.0.46 (la versión que de verdad funciona en este entorno — ver
// nota de arriba sobre la 0.35 rompiendo el bundling del wasm de harfbuzz
// en Next/webpack) ignora el `fontFamily` por elemento y usa SIEMPRE la
// PRIMERA fuente del array para todo el árbol — confirmado empíricamente
// (ver commit: moví Inter al principio y hasta "Hello October", con
// fontFamily:'Caveat' explícito, se renderizó en Inter). No es viable tener
// dos tipografías en el mismo render. Por eso el título manuscrito se
// renderiza aparte (ver renderTitlePng) con Caveat como única fuente, y se
// incrusta como <img> en el render principal, que usa Inter como única
// fuente. Los distintos *pesos* (400/700) de una misma familia sí
// funcionan bien.
async function loadInterFonts() {
  const [regular, bold] = await Promise.all([getGoogleFont('Inter', 400), getGoogleFont('Inter', 700)])
  return [
    regular && { name: 'Inter', data: regular, weight: 400 as const, style: 'normal' as const },
    bold && { name: 'Inter', data: bold, weight: 700 as const, style: 'normal' as const },
  ].filter((f): f is { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' } => !!f)
}

async function loadCaveatFont() {
  const bold = await getGoogleFont('Caveat', 700)
  return bold && [{ name: 'Caveat', data: bold, weight: 700 as const, style: 'normal' as const }]
}

const WEEKDAYS_ES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']

function buildCalendarWeeks(year: number, month: number) {
  const firstDow = new Date(year, month - 1, 1).getDay() // 0 = domingo
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

function flagUrl(code: string) {
  return `https://flagcdn.com/w80/${code}.png`
}

const TITLE_WIDTH = 640
const TITLE_HEIGHT = 130
const PAD = 56
// satori@0.0.46 maneja mal `flex: 1` anidado dos niveles (fila dentro de
// columna, ambas creciendo) — la fila de contenido terminaba con altura 0 y
// todo el texto se renderizaba fuera de su contenedor. Altura fija en vez
// de flex-grow, calculada a partir de lo que ocupan arriba el título y el
// renglón de "Holidays:".
const HEADER_HEIGHT = TITLE_HEIGHT + 24 + 32 + 28
const CONTENT_HEIGHT = HEIGHT - PAD * 2 - HEADER_HEIGHT
const COL_GAP = 40
const COUNTRY_COL_WIDTH = WIDTH - PAD * 2 - CAL_WIDTH - COL_GAP

export function HolidaysBotImage({ data, titleImageDataUrl }: { data: HolidaysBotMonthData; titleImageDataUrl: string }) {
  const highlightDays = new Set(
    data.countries.flatMap((c) => c.holidays.map((h) => Number(h.date.slice(8, 10))))
  )
  const weeks = buildCalendarWeeks(data.year, data.month)

  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: PASTEL_BG,
        padding: PAD,
        fontFamily: 'Inter',
        position: 'relative',
      }}
    >
      {/* Decoración de esquinas — stand-in simple hasta conseguir el asset original de Anabella */}
      <div style={{ position: 'absolute', top: -60, left: -60, width: 180, height: 180, borderRadius: 999, backgroundColor: '#e3ead9', display: 'flex' }} />
      <div style={{ position: 'absolute', bottom: -80, right: -80, width: 220, height: 220, borderRadius: 999, backgroundColor: '#e3ead9', display: 'flex' }} />

      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 16 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={titleImageDataUrl} width={TITLE_WIDTH} height={TITLE_HEIGHT} alt={`Hello ${data.monthNameEn}`} />
        <span style={{ fontFamily: 'Inter', fontSize: 40, color: ACCENT, fontWeight: 700 }}>{data.year}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 24, marginBottom: 28 }}>
        {/* Círculo decorativo en vez de un emoji de globo — Satori no tiene
            fuente de emoji a color embebida y cae a una fuente default que
            en Windows rompe la ruta del archivo (bug conocido de
            @vercel/og). Evitamos cualquier glyph fuera de Caveat/Inter. */}
        <span style={{ display: 'flex', width: 14, height: 14, borderRadius: 999, backgroundColor: ACCENT }} />
        <span style={{ fontFamily: 'Inter', fontSize: 28, color: INK, fontWeight: 700 }}>Holidays:</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', height: CONTENT_HEIGHT, gap: COL_GAP }}>
        {/* Columna de países */}
        <div style={{ display: 'flex', flexDirection: 'column', width: COUNTRY_COL_WIDTH, gap: 24 }}>
          {data.countries.length === 0 && (
            <span style={{ fontFamily: 'Inter', fontSize: 22, color: '#6b7280' }}>Sin feriados este mes.</span>
          )}
          {data.countries.map((c) => (
            <div key={c.country} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={flagUrl(c.code)} width={36} height={24} style={{ borderRadius: 3 }} alt="" />
                <span style={{ fontFamily: 'Inter', fontSize: 24, fontWeight: 700, color: INK }}>{c.country}</span>
              </div>
              {c.holidays.map((h) => (
                <span key={h.date} style={{ fontFamily: 'Inter', fontSize: 19, color: '#4b5563', paddingLeft: 46 }}>
                  {Number(h.date.slice(8, 10))}/{data.month} - {h.name}
                </span>
              ))}
            </div>
          ))}
        </div>

        {/* Mini calendario */}
        <div style={{ display: 'flex', flexDirection: 'column', width: CAL_WIDTH, backgroundColor: '#ffffff', borderRadius: 16, padding: CAL_PAD }}>
          <span style={{ fontFamily: 'Inter', fontSize: 20, fontWeight: 700, color: INK, marginBottom: 12, textTransform: 'uppercase' as const }}>
            {data.monthNameEs} {data.year}
          </span>
          <div style={{ display: 'flex', flexDirection: 'row' }}>
            {WEEKDAYS_ES.map((d) => (
              <div key={d} style={{ display: 'flex', width: CAL_CELL, justifyContent: 'center' }}>
                <span style={{ fontFamily: 'Inter', fontSize: 12, color: '#9ca3af', fontWeight: 700 }}>{d}</span>
              </div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'row' }}>
              {week.map((day, di) => (
                <div key={di} style={{ display: 'flex', width: CAL_CELL, justifyContent: 'center', padding: '6px 0' }}>
                  {day && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 30,
                        height: 30,
                        borderRadius: 999,
                        backgroundColor: highlightDays.has(day) ? ACCENT : 'transparent',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'Inter',
                          color: highlightDays.has(day) ? '#ffffff' : '#374151',
                          fontSize: 14,
                          fontWeight: highlightDays.has(day) ? 700 : 400,
                        }}
                      >
                        {day}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

async function renderPngViaSatori(
  element: JSX.Element,
  opts: { width: number; height: number; fonts: { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }[] }
): Promise<Uint8Array> {
  if (!opts.fonts.length) {
    throw new Error('No se pudo cargar ninguna fuente para generar la imagen.')
  }
  const svg = await satori(element, opts)
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: opts.width } })
  return resvg.render()
}

async function renderTitlePng(monthNameEn: string): Promise<string> {
  const fonts = await loadCaveatFont()
  const png = await renderPngViaSatori(
    <div
      style={{
        width: TITLE_WIDTH,
        height: TITLE_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        fontFamily: 'Caveat',
        fontSize: 92,
        fontWeight: 700,
        color: INK,
      }}
    >
      Hello {monthNameEn}
    </div>,
    { width: TITLE_WIDTH, height: TITLE_HEIGHT, fonts: fonts ?? [] }
  )
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`
}

// Devuelve el PNG ya codificado (igual que ImageResponse, pero sin pasar
// por el wrapper roto de Next — ver nota arriba).
export async function renderHolidaysBotImagePng(data: HolidaysBotMonthData): Promise<Uint8Array> {
  await ensureResvgWasm()
  const [interFonts, titleImageDataUrl] = await Promise.all([loadInterFonts(), renderTitlePng(data.monthNameEn)])

  return renderPngViaSatori(<HolidaysBotImage data={data} titleImageDataUrl={titleImageDataUrl} />, {
    width: WIDTH,
    height: HEIGHT,
    fonts: interFonts,
  })
}

export async function renderHolidaysBotImage(data: HolidaysBotMonthData): Promise<Response> {
  const png = await renderHolidaysBotImagePng(data)
  return new Response(new Uint8Array(png), {
    headers: { 'content-type': 'image/png', 'cache-control': 'no-cache, no-store' },
  })
}
