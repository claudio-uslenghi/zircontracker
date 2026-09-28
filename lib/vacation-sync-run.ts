import { prisma } from '@/lib/prisma'
import {
  SheetFormatError,
  deletesExceedCap,
  parseSheetRows,
  planSync,
  type ExistingVacation,
  type SyncIssue,
  type SyncPlan,
} from '@/lib/vacation-sync'

export const SYNC_SOURCE = 'vacations-sheet'

export type SyncTrigger = 'cron' | 'manual'

export interface SyncOutcome {
  dryRun: boolean
  counts: {
    create: number
    update: number
    adopt: number
    delete: number
    unchanged: number
    unmatched: number
    errors: number
  }
  create: { rowNumber: number; resourceName: string; startDate: string; endDate: string; type: string; halfDay: boolean }[]
  update: { resourceName: string; startDate: string; endDate: string; changes: string[] }[]
  adopt: { resourceName: string; startDate: string; endDate: string }[]
  delete: { resourceName: string; startDate: string; endDate: string }[]
  unmatched: { email: string; rowNumbers: number[] }[]
  errors: SyncIssue[]
  warnings: string[]
  collapsed: number
  // Deletions were planned but held back (cron over the safety cap).
  deleteBlocked: boolean
}

const dateOnly = (d: Date | string) => new Date(d).toISOString().slice(0, 10)

async function inBatches<T>(items: T[], fn: (item: T) => Promise<unknown>, size = 8) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}

// Fetches the JSON exposed by the Apps Script web app (env VACATIONS_SHEET_URL).
export async function fetchSheetRows(): Promise<unknown> {
  const url = process.env.VACATIONS_SHEET_URL
  if (!url) throw new SheetFormatError('Falta configurar VACATIONS_SHEET_URL.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)
  try {
    const res = await fetch(url, { redirect: 'follow', cache: 'no-store', signal: controller.signal })
    if (!res.ok) throw new SheetFormatError(`La planilla respondió HTTP ${res.status}.`)
    try {
      return await res.json()
    } catch {
      throw new SheetFormatError('La planilla no devolvió JSON válido.')
    }
  } finally {
    clearTimeout(timer)
  }
}

function toOutcome(plan: SyncPlan, parsed: ReturnType<typeof parseSheetRows>, dryRun: boolean, deleteBlocked: boolean): SyncOutcome {
  return {
    dryRun,
    counts: {
      create: plan.create.length,
      update: plan.update.length,
      adopt: plan.adopt.length,
      delete: plan.delete.length,
      unchanged: plan.unchanged,
      unmatched: plan.unmatched.length,
      errors: parsed.errors.length,
    },
    create: plan.create.map((i) => ({
      rowNumber: i.entry.rowNumber, resourceName: i.resourceName, startDate: i.entry.startDate,
      endDate: i.entry.endDate, type: i.entry.type, halfDay: i.entry.halfDay,
    })),
    update: plan.update.map((u) => ({ resourceName: u.item.resourceName, startDate: u.item.entry.startDate, endDate: u.item.entry.endDate, changes: u.changes })),
    adopt: plan.adopt.map((a) => ({ resourceName: a.item.resourceName, startDate: a.item.entry.startDate, endDate: a.item.entry.endDate })),
    delete: plan.delete.map((d) => ({ resourceName: d.resourceName, startDate: d.startDate, endDate: d.endDate })),
    unmatched: plan.unmatched,
    errors: parsed.errors,
    warnings: parsed.warnings,
    collapsed: parsed.collapsed,
    deleteBlocked,
  }
}

// Core of both the cron and the admin button. `rows` is injectable so it can be
// exercised without hitting the sheet. Only vacations carrying a sourceKey are
// ever updated or deleted; hand-loaded ones (sourceKey NULL) are never modified,
// except to be "adopted" when they are identical to a sheet row.
export async function runVacationSync(opts: {
  rows: unknown
  dryRun: boolean
  trigger: SyncTrigger
  // Manual runs may delete past the safety cap after explicit confirmation.
  allowLargeDeletes?: boolean
}): Promise<SyncOutcome> {
  const parsed = parseSheetRows(opts.rows)

  const [resources, vacations] = await Promise.all([
    prisma.resource.findMany({ select: { id: true, name: true, email: true } }),
    prisma.vacation.findMany({
      select: { id: true, resourceId: true, startDate: true, endDate: true, halfDay: true, type: true, sourceKey: true },
    }),
  ])
  const existing: ExistingVacation[] = vacations.map((v) => ({
    ...v,
    startDate: dateOnly(v.startDate),
    endDate: dateOnly(v.endDate),
  }))

  const plan = planSync(parsed, resources, existing)
  const deleteBlocked =
    plan.delete.length > 0 && !opts.allowLargeDeletes && deletesExceedCap(plan.delete.length, plan.mirroredCount)

  if (opts.dryRun) return toOutcome(plan, parsed, true, deleteBlocked)

  const dataOf = (item: { entry: { startDate: string; endDate: string; halfDay: boolean; type: string; sourceKey: string }; resourceId: number }) => ({
    resourceId: item.resourceId,
    startDate: new Date(item.entry.startDate),
    endDate: new Date(item.entry.endDate),
    halfDay: item.entry.halfDay,
    type: item.entry.type,
    sourceKey: item.entry.sourceKey,
  })

  // Small parallel batches: the first sync can touch ~100 rows and serverless
  // functions have a time limit.
  await inBatches(plan.create, (item) => prisma.vacation.create({ data: { ...dataOf(item), notes: '' } }))
  await inBatches(plan.update, (u) => prisma.vacation.update({ where: { id: u.id }, data: dataOf(u.item) }))
  await inBatches(plan.adopt, (a) =>
    prisma.vacation.update({ where: { id: a.id }, data: { sourceKey: a.item.entry.sourceKey, halfDay: a.item.entry.halfDay, type: a.item.entry.type } })
  )
  if (!deleteBlocked && plan.delete.length) {
    await prisma.vacation.deleteMany({ where: { id: { in: plan.delete.map((d) => d.id) }, sourceKey: { not: null } } })
  }

  const outcome = toOutcome(plan, parsed, false, deleteBlocked)
  await recordRun(opts.trigger, outcome, true)
  return outcome
}

export async function recordRun(trigger: SyncTrigger, outcome: SyncOutcome | null, ok: boolean, errorMessage?: string) {
  const applied = outcome && !outcome.deleteBlocked ? outcome.counts.delete : 0
  await prisma.syncRun.create({
    data: {
      source: SYNC_SOURCE,
      trigger,
      ok,
      created: outcome?.counts.create ?? 0,
      updated: (outcome?.counts.update ?? 0) + (outcome?.counts.adopt ?? 0),
      deleted: applied,
      unchanged: outcome?.counts.unchanged ?? 0,
      unmatchedCount: outcome?.counts.unmatched ?? 0,
      errorCount: outcome?.counts.errors ?? (ok ? 0 : 1),
      details: JSON.stringify(
        outcome
          ? { unmatched: outcome.unmatched, errors: outcome.errors, warnings: outcome.warnings, deleteBlocked: outcome.deleteBlocked }
          : { error: errorMessage ?? 'Error' }
      ),
    },
  })
}
