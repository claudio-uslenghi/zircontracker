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

import type { ComputedRow, XlsxCell } from './invoice-sheet'

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

// Creates the tab if missing (and returns its real sheetId either way — the
// numeric id formatting requests need, distinct from the title string).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureTab(sheets: any, spreadsheetId: string, title: string): Promise<number> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (meta.data.sheets ?? []).find((s: any) => s.properties?.title === title)
  if (existing) return existing.properties.sheetId
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  })
  return res.data.replies[0].addSheet.properties.sheetId
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

// Real colors read off the hand-maintained "Invoicing" tabs via the Sheets
// API (not guessed from a screenshot) — see SPEC.md "colores de la hoja
// Invoicing". Applied fresh on every sync (create or update), so the result
// never depends on someone having duplicated a formatted tab by hand first.
const COLOR_GREEN = { green: 1 }
const COLOR_RED = { red: 0.91764706, green: 0.2627451, blue: 0.20784314 }
const COLOR_YELLOW = { red: 1, green: 1 }
const COLOR_ORANGE = { red: 1, green: 0.6 }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellFormat(sheetId: number, rowIndex: number, startCol: number, endCol: number, format: Record<string, any>) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: startCol, endColumnIndex: endCol },
      cell: { userEnteredFormat: format },
      fields: 'userEnteredFormat(backgroundColor,textFormat.bold)',
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildInvoicingFormatRequests(sheetId: number, computedRows: ComputedRow[], totalRows: number): any[] {
  const requests = [
    // Clear any leftover formatting first — a month with fewer/different
    // blocks than whatever was there before shouldn't inherit stale colors.
    cellFormat(sheetId, 0, 0, 6, {}),
  ]
  // Shift the clear request's range to cover every row, not just row 0.
  requests[0].repeatCell.range.endRowIndex = Math.max(totalRows, 1)

  let firstTitleSeen = false
  for (const row of computedRows) {
    const r = row.sheetRow - 1
    if (row.kind === 'title' && !firstTitleSeen) {
      firstTitleSeen = true
      requests.push(cellFormat(sheetId, r, 1, 5, { backgroundColor: COLOR_ORANGE, textFormat: { bold: true } }))
    } else if (row.kind === 'header') {
      requests.push(cellFormat(sheetId, r, 0, 1, { backgroundColor: COLOR_GREEN })) // OK
      requests.push(cellFormat(sheetId, r, 1, 2, { backgroundColor: COLOR_RED, textFormat: { bold: true } })) // cliente
      requests.push(cellFormat(sheetId, r, 2, 4, { backgroundColor: COLOR_GREEN })) // Precio/Horas
      requests.push(cellFormat(sheetId, r, 4, 5, { backgroundColor: COLOR_YELLOW })) // Total
    }
  }
  return requests
}

export interface SheetsSyncResult {
  status: 'ok' | 'skipped' | 'error'
  message?: string
}

export async function syncInvoicingMonth(
  month: string,
  pivotRows: (string | number)[][],
  invoiceCells: XlsxCell[][],
  computedRows: ComputedRow[]
): Promise<SheetsSyncResult> {
  if (!sheetsConfigured()) return { status: 'skipped' }

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!
  try {
    const sheets = await getSheetsClient()
    const invoicingTitle = invoicingTabName(month)
    const hoursTitle = hoursTabName(month)

    const invoicingSheetId = await ensureTab(sheets, spreadsheetId, invoicingTitle)
    await ensureTab(sheets, spreadsheetId, hoursTitle)
    await writeGrid(sheets, spreadsheetId, invoicingTitle, cellsToGrid(invoiceCells))
    await writeGrid(sheets, spreadsheetId, hoursTitle, pivotRows)

    const formatRequests = buildInvoicingFormatRequests(invoicingSheetId, computedRows, invoiceCells.length)
    if (formatRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: formatRequests } })
    }

    return { status: 'ok' }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return { status: 'error', message }
  }
}
