// Sync de la facturación mensual hacia la planilla real de Google Sheets que
// usa el equipo de invoicing (fuera de este proyecto, mantenida a mano hasta
// ahora). Dos tabs por mes, creados la primera vez y actualizados el resto:
//   - "Invoicing <Mes en inglés> <Año>"          -> espejo de la hoja "Facturas"
//   - "Horas por proyecto <Mes en español> <Año>" -> espejo del pivot "Info para invoicing"
// Convención de nombres confirmada inspeccionando la planilla real (ver SPEC.md).
//
// Nunca bloquea la generación del .xlsx: si no hay credenciales configuradas,
// o la API de Sheets falla (spreadsheet no compartida, red, etc.), se reporta
// el estado al caller en vez de tirar — el .xlsx y los ClientInvoice ya creados
// son el resultado principal, esto es un espejo best-effort.

import type { XlsxCell } from './invoice-sheet'

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export function invoicingTabName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `Invoicing ${MONTHS_EN[m - 1]} ${y}`
}

export function hoursTabName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `Horas por proyecto ${MONTHS_ES[m - 1]} ${y}`
}

export function sheetsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL &&
    process.env.GOOGLE_SHEETS_PRIVATE_KEY &&
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  )
}

async function getSheetsClient() {
  const { google } = await import('googleapis')
  const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL!
  const key = process.env.GOOGLE_SHEETS_PRIVATE_KEY!.replace(/\\n/g, '\n')
  const auth = new google.auth.JWT({
    email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

function quoteTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureTab(sheets: any, spreadsheetId: string, title: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exists = (meta.data.sheets ?? []).some((s: any) => s.properties?.title === title)
  if (exists) return
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeGrid(sheets: any, spreadsheetId: string, title: string, values: (string | number)[][]): Promise<void> {
  const range = `${quoteTitle(title)}!A1`
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: quoteTitle(title) })
  if (values.length === 0) return
  await sheets.spreadsheets.values.update({
    spreadsheetId, range, valueInputOption: 'USER_ENTERED', requestBody: { values },
  })
}

function cellsToGrid(cells: XlsxCell[][]): (string | number)[][] {
  return cells.map((row) => row.map((cell) => {
    if (cell.f) return `=${cell.f}`
    if (cell.v === undefined) return ''
    return cell.v
  }))
}

export interface SheetsSyncResult {
  status: 'ok' | 'skipped' | 'error'
  message?: string
}

export async function syncInvoicingMonth(
  month: string,
  pivotRows: (string | number)[][],
  invoiceCells: XlsxCell[][]
): Promise<SheetsSyncResult> {
  if (!sheetsConfigured()) return { status: 'skipped' }

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!
  try {
    const sheets = await getSheetsClient()
    const invoicingTitle = invoicingTabName(month)
    const hoursTitle = hoursTabName(month)

    await ensureTab(sheets, spreadsheetId, invoicingTitle)
    await ensureTab(sheets, spreadsheetId, hoursTitle)
    await writeGrid(sheets, spreadsheetId, invoicingTitle, cellsToGrid(invoiceCells))
    await writeGrid(sheets, spreadsheetId, hoursTitle, pivotRows)

    return { status: 'ok' }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return { status: 'error', message }
  }
}
