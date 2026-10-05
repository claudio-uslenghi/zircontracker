import { prisma } from '@/lib/prisma'
import { FLAG_BY_NAME, CODE_BY_NAME } from '@/lib/countries'

export interface CountryHolidaysGroup {
  country: string
  flag: string
  code: string
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

// "Países con recursos activos" = países que aparecen en Resource.country hoy
// (no existe un flag de activo/inactivo en Resource — ver SPEC.md).
async function getCountriesWithResources(): Promise<string[]> {
  const rows = await prisma.resource.findMany({
    select: { country: true },
    distinct: ['country'],
  })
  return rows.map((r) => r.country).filter(Boolean)
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

export async function getHolidaysBotMonthData(year: number, month: number): Promise<HolidaysBotMonthData> {
  const countries = await getCountriesWithResources()
  const { start, end } = monthRange(year, month)

  const holidays = countries.length
    ? await prisma.countryHoliday.findMany({
        where: { country: { in: countries }, date: { gte: start, lte: end } },
        orderBy: [{ country: 'asc' }, { date: 'asc' }],
      })
    : []

  const byCountry = new Map<string, CountryHolidaysGroup>()
  for (const h of holidays) {
    if (!byCountry.has(h.country)) {
      byCountry.set(h.country, {
        country: h.country,
        flag: FLAG_BY_NAME[h.country] ?? '🌍',
        code: (CODE_BY_NAME[h.country] ?? 'OT').toLowerCase(),
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
