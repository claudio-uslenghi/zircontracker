// Pure logic (no network, no Prisma) for mirroring the vacations Google Sheet
// into the Vacation table. The sheet is fed by a Google Form; a Google Apps
// Script web app exposes it as JSON: an array of arrays, first row = header,
// dates as ISO strings at local midnight of the sheet's timezone (UTC-3).

export const EXPECTED_HEADER = [
  'Timestamp',
  'Email Address',
  'Starting',
  'Finishing',
  'Half Day or Full Day?',
  'Type of Time off',
]

// Argentina/Uruguay: fixed UTC-3, no daylight saving.
const SHEET_OFFSET_MS = 3 * 60 * 60 * 1000
const LOCAL_MIDNIGHT_SUFFIX = 'T03:00:00.000Z'

// Mirrored rows are limited to the current year onwards.
export const DELETE_CAP_ABSOLUTE = 10
export const DELETE_CAP_RATIO = 0.2

export class SheetFormatError extends Error {
  constructor(message: string) {
    super(message)
    // Keeps `instanceof` working when compiled to ES5 targets.
    Object.setPrototypeOf(this, SheetFormatError.prototype)
  }
}

export interface SheetEntry {
  sourceKey: string
  rowNumber: number
  email: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  halfDay: boolean
  type: string
  submittedAt: string
  // Keys of older rows that describe the exact same period and were collapsed
  // into this (most recent) one — lets an existing vacation be re-keyed.
  shadowKeys: string[]
}

export interface SyncIssue {
  rowNumber: number
  email: string
  message: string
}

export interface ParsedSheet {
  entries: SheetEntry[]
  // Keys of EVERY well-formed row, whatever its year: a keyed vacation is only
  // considered deleted when its key is gone from the sheet altogether.
  allKeys: Set<string>
  errors: SyncIssue[]
  warnings: string[]
  skippedOld: number
  collapsed: number
}

function toLocalDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = Date.parse(value)
  if (Number.isNaN(t)) return null
  return new Date(t - SHEET_OFFSET_MS).toISOString().slice(0, 10)
}

export function parseSheetRows(rows: unknown, today: Date = new Date()): ParsedSheet {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new SheetFormatError('La planilla no devolvió filas (respuesta vacía o con formato inesperado).')
  }
  const header = rows[0]
  if (
    !Array.isArray(header) ||
    EXPECTED_HEADER.some((h, i) => String(header[i] ?? '').trim() !== h)
  ) {
    throw new SheetFormatError('El encabezado de la planilla no coincide con el esperado.')
  }

  const currentYear = new Date(today.getTime() - SHEET_OFFSET_MS).getUTCFullYear()
  const errors: SyncIssue[] = []
  const allKeys = new Set<string>()
  const candidates: SheetEntry[] = []
  let skippedOld = 0
  let offTimezone = 0

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 1
    if (!Array.isArray(row)) continue
    const [ts, emailRaw, startRaw, endRaw, halfRaw, typeRaw] = row
    const email = String(emailRaw ?? '').trim()
    const submittedAt = String(ts ?? '').trim()
    if (!email || !submittedAt) continue

    const sourceKey = `gsheet:${submittedAt}|${email.toLowerCase()}`
    allKeys.add(sourceKey)

    const startDate = toLocalDate(startRaw)
    const endDate = toLocalDate(endRaw)
    if (!startDate || !endDate) {
      errors.push({ rowNumber, email, message: 'Fecha inválida' })
      continue
    }
    if (!String(startRaw).endsWith(LOCAL_MIDNIGHT_SUFFIX) || !String(endRaw).endsWith(LOCAL_MIDNIGHT_SUFFIX)) {
      offTimezone++
    }
    if (Number(startDate.slice(0, 4)) < currentYear) {
      skippedOld++
      continue
    }
    if (endDate < startDate) {
      errors.push({ rowNumber, email, message: `Fin (${endDate}) anterior al inicio (${startDate}) — se omite` })
      continue
    }
    candidates.push({
      sourceKey,
      rowNumber,
      email,
      startDate,
      endDate,
      halfDay: String(halfRaw ?? '').toLowerCase().includes('half'),
      type: String(typeRaw ?? '').trim() || 'Vacation / Day Off',
      submittedAt,
      shadowKeys: [],
    })
  }

  // Collapse exact duplicates (same person + period): keep the latest submission.
  const byPeriod = new Map<string, SheetEntry>()
  let collapsed = 0
  for (const entry of candidates) {
    const period = `${entry.email.toLowerCase()}|${entry.startDate}|${entry.endDate}`
    const kept = byPeriod.get(period)
    if (!kept) {
      byPeriod.set(period, entry)
      continue
    }
    collapsed++
    const [winner, loser] = Date.parse(entry.submittedAt) >= Date.parse(kept.submittedAt) ? [entry, kept] : [kept, entry]
    winner.shadowKeys = [...winner.shadowKeys, loser.sourceKey, ...loser.shadowKeys]
    byPeriod.set(period, winner)
  }

  const warnings: string[] = []
  if (offTimezone > 0) {
    warnings.push(`${offTimezone} fila(s) con fechas que no caen a medianoche UTC-3: revisá la zona horaria del script.`)
  }

  return { entries: Array.from(byPeriod.values()), allKeys, errors, warnings, skippedOld, collapsed }
}

export interface ResourceRef {
  id: number
  name: string
  email: string | null
}

export interface ExistingVacation {
  id: number
  resourceId: number
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  halfDay: boolean
  type: string
  sourceKey: string | null
}

export interface PlanItem {
  entry: SheetEntry
  resourceId: number
  resourceName: string
}

export interface SyncPlan {
  create: PlanItem[]
  update: { id: number; item: PlanItem; changes: string[] }[]
  adopt: { id: number; item: PlanItem; changes: string[] }[]
  delete: { id: number; resourceName: string; startDate: string; endDate: string }[]
  unchanged: number
  unmatched: { email: string; rowNumbers: number[] }[]
  mirroredCount: number
}

export function planSync(parsed: ParsedSheet, resources: ResourceRef[], existing: ExistingVacation[]): SyncPlan {
  const resourceByEmail = new Map<string, ResourceRef>()
  for (const r of resources) if (r.email) resourceByEmail.set(r.email.trim().toLowerCase(), r)
  const nameById = new Map(resources.map((r) => [r.id, r.name.trim()]))

  const byKey = new Map<string, ExistingVacation>()
  const unkeyed = new Map<string, ExistingVacation[]>()
  for (const v of existing) {
    if (v.sourceKey) byKey.set(v.sourceKey, v)
    else {
      const k = `${v.resourceId}|${v.startDate}|${v.endDate}`
      unkeyed.set(k, [...(unkeyed.get(k) ?? []), v])
    }
  }

  const plan: SyncPlan = {
    create: [], update: [], adopt: [], delete: [], unchanged: 0, unmatched: [],
    mirroredCount: existing.filter((v) => v.sourceKey).length,
  }
  const unmatched = new Map<string, number[]>()
  const claimed = new Set<number>()

  const diff = (v: ExistingVacation, item: PlanItem): string[] => {
    const changes: string[] = []
    if (v.resourceId !== item.resourceId) changes.push('persona')
    if (v.startDate !== item.entry.startDate || v.endDate !== item.entry.endDate) changes.push('fechas')
    if (v.halfDay !== item.entry.halfDay) changes.push('medio día')
    if (v.type !== item.entry.type) changes.push('tipo')
    return changes
  }

  for (const entry of parsed.entries) {
    const resource = resourceByEmail.get(entry.email.toLowerCase())
    if (!resource) {
      unmatched.set(entry.email.toLowerCase(), [...(unmatched.get(entry.email.toLowerCase()) ?? []), entry.rowNumber])
      continue
    }
    const item: PlanItem = { entry, resourceId: resource.id, resourceName: resource.name.trim() }

    const current = byKey.get(entry.sourceKey)
    const shadowed = current ? undefined : entry.shadowKeys.map((k) => byKey.get(k)).find((v) => v && !claimed.has(v.id))
    const known = current ?? shadowed
    if (known) {
      claimed.add(known.id)
      const changes = diff(known, item)
      if (known.sourceKey !== entry.sourceKey) changes.push('clave de fila')
      if (changes.length) plan.update.push({ id: known.id, item, changes })
      else plan.unchanged++
      continue
    }

    const candidate = (unkeyed.get(`${resource.id}|${entry.startDate}|${entry.endDate}`) ?? []).find((v) => !claimed.has(v.id))
    if (candidate) {
      claimed.add(candidate.id)
      plan.adopt.push({ id: candidate.id, item, changes: diff(candidate, item) })
      continue
    }
    plan.create.push(item)
  }

  for (const v of existing) {
    if (v.sourceKey && !parsed.allKeys.has(v.sourceKey) && !claimed.has(v.id)) {
      plan.delete.push({ id: v.id, resourceName: nameById.get(v.resourceId) ?? `#${v.resourceId}`, startDate: v.startDate, endDate: v.endDate })
    }
  }

  plan.unmatched = Array.from(unmatched.entries()).map(([email, rowNumbers]) => ({ email, rowNumbers }))
  return plan
}

// Unattended runs must not wipe rows because of a bad response: too many
// deletions at once are held back and reported instead.
export function deletesExceedCap(deleteCount: number, mirroredCount: number): boolean {
  if (deleteCount === 0) return false
  if (deleteCount > DELETE_CAP_ABSOLUTE) return true
  return mirroredCount >= 10 && deleteCount / mirroredCount > DELETE_CAP_RATIO
}
