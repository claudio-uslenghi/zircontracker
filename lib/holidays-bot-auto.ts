import { prisma } from '@/lib/prisma'
import { FLAG_BY_NAME, CODE_BY_NAME, canonicalCountryName } from '@/lib/countries'

export interface AutoCountryRow {
  country: string // nombre canónico
  flag: string
  code: string
  enabled: boolean
  hasHolidays: boolean
}

// Países incluidos en el envío automático (nombres canónicos). Si la tabla no
// existe todavía (migración sin correr) la consulta falla a propósito: es
// mejor que el cron falle y quede registrado a que mande una lista equivocada.
export async function getAutoCountries(): Promise<Set<string>> {
  const rows = await prisma.holidaysBotAutoCountry.findMany({ select: { country: true } })
  return new Set(rows.map((r) => canonicalCountryName(r.country)))
}

// Reemplaza la lista completa. Nombres canónicos, sin duplicados.
export async function setAutoCountries(countries: string[]): Promise<string[]> {
  const unique = Array.from(new Set(countries.map((c) => canonicalCountryName(c.trim())).filter(Boolean)))
  await prisma.$transaction([
    prisma.holidaysBotAutoCountry.deleteMany({}),
    ...(unique.length ? [prisma.holidaysBotAutoCountry.createMany({ data: unique.map((country) => ({ country })) })] : []),
  ])
  return unique
}

// Filas para la pantalla de configuración: países con feriados cargados +
// los ya guardados (por si uno quedó sin feriados), con "USA" y "Estados
// Unidos" fusionados en uno solo.
export async function getAutoCountryRows(): Promise<AutoCountryRow[]> {
  const [enabled, holidayCountries] = await Promise.all([
    getAutoCountries(),
    prisma.countryHoliday.findMany({ select: { country: true }, distinct: ['country'] }),
  ])
  const withHolidays = new Set(holidayCountries.map((h) => canonicalCountryName(h.country)))
  const names = new Set<string>(Array.from(withHolidays).concat(Array.from(enabled)))
  return Array.from(names)
    .sort((a, b) => a.localeCompare(b))
    .map((country) => ({
      country,
      flag: FLAG_BY_NAME[country] ?? '🌍',
      code: (CODE_BY_NAME[country] ?? 'OT').toLowerCase(),
      enabled: enabled.has(country),
      hasHolidays: withHolidays.has(country),
    }))
}
