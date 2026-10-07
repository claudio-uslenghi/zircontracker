export interface Country {
  code: string   // ISO 3166-1 alpha-2
  name: string
  flag: string
}

export const COUNTRIES: Country[] = [
  { code: 'AR', name: 'Argentina',   flag: '🇦🇷' },
  { code: 'BO', name: 'Bolivia',     flag: '🇧🇴' },
  { code: 'BR', name: 'Brasil',      flag: '🇧🇷' },
  { code: 'CL', name: 'Chile',       flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia',    flag: '🇨🇴' },
  { code: 'CR', name: 'Costa Rica',  flag: '🇨🇷' },
  { code: 'CU', name: 'Cuba',        flag: '🇨🇺' },
  { code: 'EC', name: 'Ecuador',     flag: '🇪🇨' },
  { code: 'SV', name: 'El Salvador', flag: '🇸🇻' },
  { code: 'ES', name: 'España',      flag: '🇪🇸' },
  { code: 'GT', name: 'Guatemala',   flag: '🇬🇹' },
  { code: 'HN', name: 'Honduras',    flag: '🇭🇳' },
  { code: 'MX', name: 'México',      flag: '🇲🇽' },
  { code: 'NI', name: 'Nicaragua',   flag: '🇳🇮' },
  { code: 'PA', name: 'Panamá',      flag: '🇵🇦' },
  { code: 'PY', name: 'Paraguay',    flag: '🇵🇾' },
  { code: 'PE', name: 'Perú',        flag: '🇵🇪' },
  { code: 'DO', name: 'Rep. Dominicana', flag: '🇩🇴' },
  { code: 'UY', name: 'Uruguay',     flag: '🇺🇾' },
  { code: 'VE', name: 'Venezuela',   flag: '🇻🇪' },
  { code: 'US', name: 'Estados Unidos', flag: '🇺🇸' },
  { code: 'PT', name: 'Portugal',    flag: '🇵🇹' },
  { code: 'YE', name: 'Yemen',       flag: '🇾🇪' },
  { code: 'OT', name: 'Otro',        flag: '🌍' },
]

// Variantes de nombre que ya existen cargadas a mano en CountryHoliday /
// Resource ("USA" en vez de "Estados Unidos") — se resuelven al mismo país.
const NAME_ALIASES: Record<string, string> = { USA: 'Estados Unidos' }

/** Lookup by country name → flag */
export const FLAG_BY_NAME: Record<string, string> = Object.fromEntries([
  ...COUNTRIES.map((c) => [c.name, c.flag]),
  ...Object.entries(NAME_ALIASES).map(([alias, name]) => [alias, COUNTRIES.find((c) => c.name === name)!.flag]),
])

/** Lookup by country name → ISO code */
export const CODE_BY_NAME: Record<string, string> = Object.fromEntries([
  ...COUNTRIES.map((c) => [c.name, c.code]),
  ...Object.entries(NAME_ALIASES).map(([alias, name]) => [alias, COUNTRIES.find((c) => c.name === name)!.code]),
])

/** Lookup by country name → English name (para la imagen del Holidays Bot) */
export const NAME_EN_BY_NAME: Record<string, string> = {
  Brasil: 'Brazil',
  España: 'Spain',
  México: 'Mexico',
  Panamá: 'Panama',
  Perú: 'Peru',
  'Rep. Dominicana': 'Dominican Republic',
  'Estados Unidos': 'USA',
}
