import { prisma } from '@/lib/prisma'
import { FLAG_BY_NAME, CODE_BY_NAME } from '@/lib/countries'

export interface CountryHolidaysGroup {
  country: string
  flag: string
  code: string
  // false para países fuera de lib/countries.ts (Yemen, un país escrito a
  // mano, etc.) — ahí `code` cae al fallback genérico 'ot', que NO es un
  // código ISO real: flagcdn.com/w80/ot.png no existe (404), y pedirle esa
  // URL a satori para la imagen tira "Unsupported image type: unknown" y
  // rompe toda la generación. La imagen usa este flag para mostrar un
  // placeholder en vez de intentar bajar una bandera que no existe.
  hasKnownFlag: boolean
  hasResource: boolean
  holidays: { date: string; name: string }[]
}

export interface HolidaysBotMonthData {
  year: number
  month: number // 1-12
  monthNameEn: string
  monthNameEs: string
  countries: CountryHolidaysGroup[]
}

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH_NAMES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

// No existe un flag de activo/inactivo en Resource — "tiene recursos hoy" es
// simplemente "aparece en Resource.country" (ver SPEC.md).
async function getCountriesWithResources(): Promise<Set<string>> {
  const rows = await prisma.resource.findMany({
    select: { country: true },
    distinct: ['country'],
  })
  return new Set(rows.map((r) => r.country).filter(Boolean))
}

// Fechas como string YYYY-MM-DD para no pisar con corrimientos de timezone
// (mismo criterio que formatDate en lib/date-utils.ts).
function monthRange(year: number, month: number) {
  const lastDay = new Date(year, month, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    start: new Date(`${year}-${pad(month)}-01T00:00:00.000Z`),
    end: new Date(`${year}-${pad(month)}-${pad(lastDay)}T23:59:59.999Z`),
  }
}

// Devuelve TODOS los países con feriados cargados ese mes (no solo los que
// tienen recursos hoy) — cada uno con hasResource para que el preview de
// Holidays Bot pueda mostrar "(sin recursos hoy)" y el cron automático
// pueda seguir filtrando por recursos sin un humano de por medio. Quién
// termina en el mensaje real se decide más arriba, en runHolidaysBot.
export async function getHolidaysBotMonthData(year: number, month: number): Promise<HolidaysBotMonthData> {
  const resourceCountries = await getCountriesWithResources()
  const { start, end } = monthRange(year, month)

  const holidays = await prisma.countryHoliday.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: [{ country: 'asc' }, { date: 'asc' }],
  })

  const byCountry = new Map<string, CountryHolidaysGroup>()
  for (const h of holidays) {
    if (!byCountry.has(h.country)) {
      byCountry.set(h.country, {
        country: h.country,
        flag: FLAG_BY_NAME[h.country] ?? '🌍',
        code: (CODE_BY_NAME[h.country] ?? 'OT').toLowerCase(),
        hasKnownFlag: h.country in CODE_BY_NAME,
        hasResource: resourceCountries.has(h.country),
        holidays: [],
      })
    }
    byCountry.get(h.country)!.holidays.push({ date: h.date.toISOString().slice(0, 10), name: h.name })
  }

  return {
    year,
    month,
    monthNameEn: MONTH_NAMES_EN[month - 1],
    monthNameEs: MONTH_NAMES_ES[month - 1],
    countries: Array.from(byCountry.values()).sort((a, b) => a.country.localeCompare(b.country)),
  }
}

// Recorta a un subconjunto de países (por nombre exacto) — usado tanto para
// el envío manual con selección por checkbox como para que la ruta pública
// de la imagen (que Slack descarga aparte, sin sesión) respete esa misma
// selección. `selected` nulo/undefined devuelve los datos sin tocar.
export function filterHolidaysBotCountries(
  data: HolidaysBotMonthData,
  selected?: string[] | null
): HolidaysBotMonthData {
  if (!selected) return data
  const set = new Set(selected)
  return { ...data, countries: data.countries.filter((c) => set.has(c.country)) }
}

// Texto bilingüe ES/EN, mismo formato que el mensaje de referencia de Anabella.
export function buildHolidaysBotText(data: HolidaysBotMonthData): string {
  const esDate = (iso: string) => {
    const [, m, d] = iso.split('-').map(Number)
    return `${d}/${m}`
  }

  const lines: string[] = []
  lines.push(`¡Hola equipo! 👋`)
  lines.push(`Les compartimos los feriados de ${data.monthNameEs} para que los tengan en cuenta al planificar sus actividades.`)
  lines.push(`¡Que tengan un excelente mes!`)
  lines.push('')
  lines.push(`Hi team! 👋`)
  lines.push(`Sharing ${data.monthNameEn}'s holidays so you can keep them in mind when planning your activities.`)
  lines.push(`Wishing everyone a great month!`)

  if (data.countries.length) {
    lines.push('')
    for (const c of data.countries) {
      lines.push(`${c.flag} ${c.country}`)
      for (const h of c.holidays) lines.push(`• ${esDate(h.date)} – ${h.name}`)
    }
  }

  return lines.join('\n')
}
