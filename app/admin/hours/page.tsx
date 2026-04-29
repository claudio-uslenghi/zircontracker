'use client'

import { useState, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { parse as dateParse } from 'date-fns'
import { enUS } from 'date-fns/locale'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Upload, AlertTriangle, CheckCircle2, FileText, Pencil, Trash2, Check, X, Plus, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import type {
  ParsedTimeEntry, ImportTimeEntriesResult,
  TimeEntryByResource, TimeEntryByProject, TimeEntryByMonth,
} from '@/types'

// ─── CSV Parsing ────────────────────────────────────────────────────────────

function parseCsvDate(raw: string): string | null {
  const d = dateParse(raw.trim(), 'dd/MMM/yy', new Date(), { locale: enUS })
  if (isNaN(d.getTime())) return null
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0)).toISOString()
}

function parseCsv(buffer: ArrayBuffer): ParsedTimeEntry[] {
  const bytes = new Uint8Array(buffer)
  // Strip UTF-8 BOM
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  const text = new TextDecoder('utf-8').decode(bytes.slice(start))

  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []

  const header = lines[0].split(',')

  // Find date columns (format DD/MMM/YY)
  const dateCols: { index: number; iso: string }[] = []
  for (let i = 5; i < header.length; i++) {
    const iso = parseCsvDate(header[i])
    if (iso) dateCols.push({ index: i, iso })
  }

  const entries: ParsedTimeEntry[] = []

  for (let r = 1; r < lines.length; r++) {
    // Split respecting quoted fields
    const cols = lines[r].split(',')
    const resourceName = cols[1]?.trim() ?? ''
    const projectName = cols[2]?.trim() ?? ''

    // Skip total rows (no project) or empty rows
    if (!resourceName || !projectName) continue

    for (const { index, iso } of dateCols) {
      const raw = cols[index]?.trim() ?? ''
      if (!raw || raw === '0') continue
      const hours = parseFloat(raw)
      if (isNaN(hours) || hours <= 0) continue
      entries.push({ resourceName, projectName, date: iso, hours })
    }
  }

  return entries
}

// ─── Clockify CSV Parsing ────────────────────────────────────────────────────

function parseQuotedRow(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (const c of line) {
    if (c === '"') { inQuotes = !inQuotes }
    else if (c === ',' && !inQuotes) { result.push(current.trim()); current = '' }
    else { current += c }
  }
  result.push(current.trim())
  return result
}

function parseClockifyCsv(buffer: ArrayBuffer): ParsedTimeEntry[] {
  const bytes = new Uint8Array(buffer)
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  const text = new TextDecoder('utf-8').decode(bytes.slice(start))

  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []

  // Aggregate by email+project+date (multiple time entries per day → sum)
  const agg = new Map<string, ParsedTimeEntry>()

  for (let r = 1; r < lines.length; r++) {
    const cols = parseQuotedRow(lines[r])
    const projectName = cols[0]?.trim() ?? ''
    const userName    = cols[5]?.trim() ?? ''
    const email       = cols[7]?.trim() ?? ''
    const dateRaw     = cols[10]?.trim() ?? '' // DD/MM/YYYY
    const hoursRaw    = cols[15]?.trim() ?? '' // decimal

    if (!projectName || !dateRaw || (!userName && !email)) continue
    const hours = parseFloat(hoursRaw)
    if (isNaN(hours) || hours <= 0) continue

    // Parse DD/MM/YYYY
    const parts = dateRaw.split('/')
    if (parts.length !== 3) continue
    const [d, m, y] = parts.map(Number)
    if (!d || !m || !y) continue
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toISOString()

    const key = `${email || userName}|${projectName}|${date}`
    const existing = agg.get(key)
    if (existing) {
      existing.hours = Math.round((existing.hours + hours) * 100) / 100
    } else {
      agg.set(key, { resourceName: userName, resourceEmail: email, projectName, date, hours })
    }
  }

  return Array.from(agg.values())
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatHours(h: number) {
  return h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)
}

function formatDateDisplay(iso: string) {
  const d = iso.substring(0, 10).split('-')
  return `${d[2]}/${d[1]}/${d[0]}`
}

function formatMonth(ym: string) {
  const [y, m] = ym.split('-')
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${months[parseInt(m) - 1]} ${y.slice(2)}`
}

// ─── Tab: Importar ───────────────────────────────────────────────────────────

function TabImport() {
  const [showClockify, setShowClockify] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedTimeEntry[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportTimeEntriesResult | null>(null)
  const [error, setError] = useState('')

  const handleFile = useCallback((file: File) => {
    setFileName(file.name)
    setResult(null)
    setError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      const buf = e.target?.result as ArrayBuffer
      const entries = parseCsv(buf)
      setParsed(entries)
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleImport = async () => {
    if (!parsed) return
    setImporting(true)
    setError('')
    try {
      const res = await fetch('/api/time-entries/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: parsed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al importar')
      setResult(data)
      setParsed(null)
      setFileName('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al importar')
    } finally {
      setImporting(false)
    }
  }

  // Stats for preview
  const uniqueResources = parsed ? new Set(parsed.map((e) => e.resourceName)).size : 0
  const uniqueProjects = parsed ? new Set(parsed.map((e) => e.projectName)).size : 0

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center cursor-pointer hover:border-[#0170B9] hover:bg-blue-50 transition-colors"
      >
        <Upload className="mx-auto mb-3 text-gray-400" size={36} />
        <p className="text-gray-600 font-medium">Arrastrá el archivo CSV aquí o hacé clic para seleccionarlo</p>
        <p className="text-sm text-gray-400 mt-1">Formato: User, Project, Key, Utilization, Logged, DD/MMM/YY...</p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>

      {/* Preview */}
      {parsed && (
        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
          <div className="flex items-center gap-2 text-gray-700 font-medium">
            <FileText size={18} className="text-[#0170B9]" />
            <span>{fileName}</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Entradas detectadas', value: parsed.length.toLocaleString() },
              { label: 'Personas únicas', value: uniqueResources },
              { label: 'Proyectos únicos', value: uniqueProjects },
            ].map((s) => (
              <div key={s.label} className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-[#0170B9]">{s.value}</div>
                <div className="text-xs text-gray-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Preview table */}
          <div className="overflow-x-auto max-h-48 border rounded">
            <table className="w-full text-sm">
              <thead className="bg-[#0170B9] text-white sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Persona</th>
                  <th className="px-3 py-2 text-left">Proyecto</th>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-right">Horas</th>
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 15).map((e, i) => (
                  <tr key={i} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-1.5">{e.resourceName}</td>
                    <td className="px-3 py-1.5">{e.projectName}</td>
                    <td className="px-3 py-1.5">{formatDateDisplay(e.date)}</td>
                    <td className="px-3 py-1.5 text-right">{formatHours(e.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.length > 15 && (
              <p className="text-xs text-center text-gray-400 py-2">
                ... y {parsed.length - 15} entradas más
              </p>
            )}
          </div>

          <button
            onClick={handleImport}
            disabled={importing}
            className="w-full bg-[#0170B9] text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? 'Importando...' : `Importar ${parsed.length.toLocaleString()} entradas`}
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
          <div className="flex items-center gap-2 text-green-700 font-semibold">
            <CheckCircle2 size={20} />
            Importación completada
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Insertados', value: result.inserted, color: 'text-green-600' },
              { label: 'Actualizados', value: result.updated, color: 'text-blue-600' },
              { label: 'Saltados', value: result.skipped, color: 'text-gray-500' },
            ].map((s) => (
              <div key={s.label} className="border rounded-lg p-3 text-center">
                <div className={`text-xl font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
                <div className="text-xs text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
          {result.unmatchedResources.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
              <div className="flex items-center gap-2 text-yellow-700 font-medium mb-1">
                <AlertTriangle size={16} /> Personas sin match en la DB
              </div>
              <div className="text-sm text-yellow-800">
                {result.unmatchedResources.join(', ')}
              </div>
              <p className="text-xs text-yellow-600 mt-1">
                Creá esos recursos en la sección Recursos y volvé a importar.
              </p>
            </div>
          )}
          {result.unmatchedProjects.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
              <div className="flex items-center gap-2 text-yellow-700 font-medium mb-1">
                <AlertTriangle size={16} /> Proyectos sin match en la DB
              </div>
              <div className="text-sm text-yellow-800">
                {result.unmatchedProjects.join(', ')}
              </div>
              <p className="text-xs text-yellow-600 mt-1">
                Creá esos proyectos en la sección Proyectos y volvé a importar.
              </p>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-gray-200 pt-4">
        <button
          onClick={() => setShowClockify((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-purple-600 hover:text-purple-800"
        >
          <Upload size={15} />
          {showClockify ? 'Ocultar importación Clockify' : 'Importar desde Clockify'}
        </button>
        {showClockify && <div className="mt-4"><ClockifyImport /></div>}
      </div>

      {/* Delete by month */}
      <div className="border-t border-gray-200 pt-4">
        <DeleteByMonth />
      </div>
    </div>
  )
}

// ─── Clockify Import Block ───────────────────────────────────────────────────

function ClockifyImport() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedTimeEntry[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportTimeEntriesResult | null>(null)
  const [error, setError] = useState('')

  const handleFile = useCallback((file: File) => {
    setFileName(file.name); setResult(null); setError('')
    const reader = new FileReader()
    reader.onload = (e) => setParsed(parseClockifyCsv(e.target?.result as ArrayBuffer))
    reader.readAsArrayBuffer(file)
  }, [])

  const handleImport = async () => {
    if (!parsed) return
    setImporting(true); setError('')
    try {
      const res = await fetch('/api/time-entries/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: parsed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al importar')
      setResult(data); setParsed(null); setFileName('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setImporting(false)
    }
  }

  const uniqueResources = parsed ? new Set(parsed.map((e) => e.resourceEmail ?? e.resourceName)).size : 0
  const uniqueProjects  = parsed ? new Set(parsed.map((e) => e.projectName)).size : 0

  return (
    <div className="border border-gray-200 rounded-lg p-5 space-y-4 bg-white">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold text-gray-700">Clockify</span>
        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">CSV detallado</span>
      </div>

      <div
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-purple-200 rounded-lg p-6 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-colors"
      >
        <Upload className="mx-auto mb-2 text-purple-400" size={28} />
        <p className="text-sm text-gray-600 font-medium">Arrastrá el CSV de Clockify o hacé clic</p>
        <p className="text-xs text-gray-400 mt-1">Formato: Proyecto, Usuario, Correo electrónico, Fecha de inicio, Duración (decimal)...</p>
        <input ref={fileRef} type="file" accept=".csv" className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
      </div>

      {parsed && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <FileText size={16} className="text-purple-500" />
            <span className="font-medium">{fileName}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Entradas agrupadas', value: parsed.length.toLocaleString() },
              { label: 'Personas únicas', value: uniqueResources },
              { label: 'Proyectos únicos', value: uniqueProjects },
            ].map((s) => (
              <div key={s.label} className="bg-purple-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-purple-600">{s.value}</div>
                <div className="text-xs text-gray-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">Las horas del mismo recurso/proyecto/día se sumaron automáticamente.</p>
          <button onClick={handleImport} disabled={importing}
            className="w-full bg-purple-600 text-white py-2 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 text-sm">
            {importing ? 'Importando...' : `Importar ${parsed.length.toLocaleString()} entradas`}
          </button>
        </div>
      )}

      {result && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
          <div className="flex items-center gap-2 text-green-700 font-semibold text-sm">
            <CheckCircle2 size={16} /> Importación Clockify completada
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Insertados', value: result.inserted, color: 'text-green-600' },
              { label: 'Actualizados', value: result.updated, color: 'text-blue-600' },
              { label: 'Saltados', value: result.skipped, color: 'text-gray-500' },
            ].map((s) => (
              <div key={s.label} className="border rounded p-2 text-center">
                <div className={`text-lg font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
                <div className="text-xs text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
          {result.unmatchedResources.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
              <div className="flex items-center gap-1 text-yellow-700 font-medium mb-1">
                <AlertTriangle size={14} /> Personas sin match
              </div>
              <div className="text-yellow-800 text-xs">{result.unmatchedResources.join(', ')}</div>
              <p className="text-xs text-yellow-600 mt-1">Verificá que el nombre del recurso en la DB coincida con el email de Clockify (ej: cuslenghi@zircon.tech → Claudio Uslenghi).</p>
            </div>
          )}
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">{error}</div>}
    </div>
  )
}

// ─── Delete by Month Block ────────────────────────────────────────────────────

function DeleteByMonth() {
  const [month, setMonth] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [result, setResult] = useState<{ deleted: number; month: string } | null>(null)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    if (!month) return
    const label = month // YYYY-MM
    if (!confirm(`¿Eliminar TODAS las horas del mes ${label}? Esta acción no se puede deshacer.`)) return
    setDeleting(true); setError(''); setResult(null)
    try {
      const res = await fetch(`/api/time-entries?month=${label}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al eliminar')
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="border border-red-200 rounded-lg p-5 bg-white space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold text-gray-700">Eliminar horas por mes</span>
        <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Irreversible</span>
      </div>
      <p className="text-sm text-gray-500">Eliminá todas las horas registradas de un mes específico para poder volver a importarlas.</p>
      <div className="flex items-center gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => { setMonth(e.target.value); setResult(null) }}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm"
        />
        <button
          onClick={handleDelete}
          disabled={!month || deleting}
          className="px-4 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition-colors"
        >
          {deleting ? 'Eliminando...' : 'Eliminar mes'}
        </button>
      </div>
      {result && (
        <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 size={16} />
          Se eliminaron <strong>{result.deleted.toLocaleString()}</strong> registros del mes {result.month}.
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">{error}</div>}
    </div>
  )
}

// ─── Tab: Tabla ──────────────────────────────────────────────────────────────

type RawEntry = {
  id: number
  resourceId: number
  projectId: number
  date: string
  hours: number
  resource: { id: number; name: string; color: string }
  project:  { id: number; name: string; color: string }
}

type EditForm = { resourceId: string; projectId: string; date: string; hours: string }

function TabTabla() {
  const qc = useQueryClient()
  const [resourceId, setResourceId] = useState('')
  const [projectId,  setProjectId]  = useState('')
  const [dateFrom,   setDateFrom]   = useState('')
  const [dateTo,     setDateTo]     = useState('')
  const [month,      setMonth]      = useState('')
  const [page,       setPage]       = useState(1)

  // sort state
  const [sortBy,  setSortBy]  = useState<'date' | 'resource' | 'project'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // edit state
  const [editingId,  setEditingId]  = useState<number | null>(null)
  const [editForm,   setEditForm]   = useState<EditForm>({ resourceId: '', projectId: '', date: '', hours: '' })
  const [saving,     setSaving]     = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // add state
  const [isAdding,     setIsAdding]     = useState(false)
  const [newForm,      setNewForm]      = useState({ resourceId: '', projectId: '', date: '', hours: '' })
  const [addingSaving, setAddingSaving] = useState(false)

  const { data: resources } = useQuery({ queryKey: ['resources'], queryFn: () => fetch('/api/resources').then((r) => r.json()) })
  const { data: projects }  = useQuery({ queryKey: ['projects'],  queryFn: () => fetch('/api/projects').then((r) => r.json()) })

  const rawKey = ['time-entries', 'raw', resourceId, projectId, dateFrom, dateTo, month, page, sortBy, sortDir]
  const params = new URLSearchParams({
    view: 'raw', page: String(page), pageSize: '100',
    sortBy, sortDir,
    ...(resourceId && { resourceId }),
    ...(projectId  && { projectId }),
    ...(month ? { month } : {}),
    ...(!month && dateFrom ? { dateFrom } : {}),
    ...(!month && dateTo   ? { dateTo }   : {}),
  })

  const { data, isFetching } = useQuery({
    queryKey: rawKey,
    queryFn: () => fetch(`/api/time-entries?${params}`).then((r) => r.json()),
  })

  const entries: RawEntry[] = data?.entries ?? []
  const total      = data?.total ?? 0
  const totalPages = Math.ceil(total / 100)
  const totalHours = entries.reduce((s, e) => s + e.hours, 0)

  const clearFilters = () => {
    setResourceId(''); setProjectId(''); setDateFrom(''); setDateTo(''); setMonth(''); setPage(1)
  }

  const startEdit = (e: RawEntry) => {
    setEditingId(e.id)
    setEditForm({
      resourceId: String(e.resourceId),
      projectId:  String(e.projectId),
      date:       e.date.substring(0, 10),
      hours:      String(e.hours),
    })
  }

  const cancelEdit = () => { setEditingId(null); setSaving(false) }

  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/time-entries/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId: Number(editForm.resourceId),
          projectId:  Number(editForm.projectId),
          date:       new Date(editForm.date + 'T12:00:00Z').toISOString(),
          hours:      Number(editForm.hours),
        }),
      })
      if (!res.ok) throw new Error('Error al guardar')
      qc.invalidateQueries({ queryKey: ['time-entries'] })
      setEditingId(null)
    } catch {
      alert('Error al guardar el registro')
    } finally {
      setSaving(false)
    }
  }

  const deleteEntry = async (id: number) => {
    if (!confirm('¿Eliminar este registro de horas?')) return
    setDeletingId(id)
    try {
      await fetch(`/api/time-entries/${id}`, { method: 'DELETE' })
      qc.invalidateQueries({ queryKey: ['time-entries'] })
    } finally {
      setDeletingId(null)
    }
  }

  const handleSort = (col: 'date' | 'resource' | 'project') => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
    setPage(1)
  }

  const saveNew = async () => {
    if (!newForm.resourceId || !newForm.projectId || !newForm.date || !newForm.hours) {
      alert('Completar todos los campos')
      return
    }
    setAddingSaving(true)
    try {
      const res = await fetch('/api/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId: Number(newForm.resourceId),
          projectId:  Number(newForm.projectId),
          date:       new Date(newForm.date + 'T12:00:00Z').toISOString(),
          hours:      Number(newForm.hours),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al guardar')
      }
      qc.invalidateQueries({ queryKey: ['time-entries'] })
      setIsAdding(false)
      setNewForm({ resourceId: '', projectId: '', date: '', hours: '' })
    } catch (err) {
      alert(`Error: ${(err as Error).message}`)
    } finally {
      setAddingSaving(false)
    }
  }

  function SortIcon({ col }: { col: 'date' | 'resource' | 'project' }) {
    if (sortBy !== col) return <ArrowUpDown size={12} className="opacity-40" />
    return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <select value={resourceId} onChange={(e) => { setResourceId(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          <option value="">Todas las personas</option>
          {(resources ?? []).map((r: { id: number; name: string }) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          <option value="">Todos los proyectos</option>
          {(projects ?? []).map((p: { id: number; name: string }) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input type="month" value={month}
          onChange={(e) => { setMonth(e.target.value); setDateFrom(''); setDateTo(''); setPage(1) }}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        <input type="date" value={dateFrom} disabled={!!month}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm disabled:opacity-40" />
        <input type="date" value={dateTo} disabled={!!month}
          onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm disabled:opacity-40" />
        <button onClick={clearFilters}
          className="text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded px-3 py-1.5">
          Limpiar filtros
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
          <span className="text-sm text-gray-600">
            {isFetching ? 'Cargando...' : `${total.toLocaleString()} registros`}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-[#0170B9]">Total: {formatHours(totalHours)} hs</span>
            <button
              onClick={() => { setIsAdding(true); setEditingId(null) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#0170B9] text-white rounded hover:bg-[#0160a0] transition-colors"
            >
              <Plus size={14} /> Nueva entrada
            </button>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full text-sm">
            <thead className="bg-[#0170B9] text-white sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left cursor-pointer hover:bg-[#0161a5] select-none"
                    onClick={() => handleSort('resource')}>
                  <span className="inline-flex items-center gap-1">Persona <SortIcon col="resource" /></span>
                </th>
                <th className="px-4 py-2 text-left cursor-pointer hover:bg-[#0161a5] select-none"
                    onClick={() => handleSort('project')}>
                  <span className="inline-flex items-center gap-1">Proyecto <SortIcon col="project" /></span>
                </th>
                <th className="px-4 py-2 text-left cursor-pointer hover:bg-[#0161a5] select-none"
                    onClick={() => handleSort('date')}>
                  <span className="inline-flex items-center gap-1">Fecha <SortIcon col="date" /></span>
                </th>
                <th className="px-4 py-2 text-right">Horas</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {isAdding && (
                <tr className="border-t bg-green-50">
                  <td className="px-2 py-1.5">
                    <select value={newForm.resourceId}
                      onChange={(ev) => setNewForm((f) => ({ ...f, resourceId: ev.target.value }))}
                      className="border rounded px-2 py-1 text-xs w-full">
                      <option value="">Persona...</option>
                      {(resources ?? []).map((r: { id: number; name: string }) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={newForm.projectId}
                      onChange={(ev) => setNewForm((f) => ({ ...f, projectId: ev.target.value }))}
                      className="border rounded px-2 py-1 text-xs w-full">
                      <option value="">Proyecto...</option>
                      {(projects ?? []).map((p: { id: number; name: string }) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="date" value={newForm.date}
                      onChange={(ev) => setNewForm((f) => ({ ...f, date: ev.target.value }))}
                      className="border rounded px-2 py-1 text-xs w-full" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" step="0.5" min="0.5" value={newForm.hours}
                      onChange={(ev) => setNewForm((f) => ({ ...f, hours: ev.target.value }))}
                      className="border rounded px-2 py-1 text-xs w-20 text-right" />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <button onClick={saveNew} disabled={addingSaving}
                        className="p-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50" title="Guardar">
                        <Check size={13} />
                      </button>
                      <button onClick={() => { setIsAdding(false); setNewForm({ resourceId: '', projectId: '', date: '', hours: '' }) }}
                        className="p-1.5 rounded bg-gray-200 text-gray-600 hover:bg-gray-300" title="Cancelar">
                        <X size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {entries.map((e) => (
                editingId === e.id ? (
                  /* ── Edit row ── */
                  <tr key={e.id} className="border-t bg-blue-50">
                    <td className="px-2 py-1.5">
                      <select value={editForm.resourceId}
                        onChange={(ev) => setEditForm((f) => ({ ...f, resourceId: ev.target.value }))}
                        className="border rounded px-2 py-1 text-xs w-full">
                        {(resources ?? []).map((r: { id: number; name: string }) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={editForm.projectId}
                        onChange={(ev) => setEditForm((f) => ({ ...f, projectId: ev.target.value }))}
                        className="border rounded px-2 py-1 text-xs w-full">
                        {(projects ?? []).map((p: { id: number; name: string }) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="date" value={editForm.date}
                        onChange={(ev) => setEditForm((f) => ({ ...f, date: ev.target.value }))}
                        className="border rounded px-2 py-1 text-xs w-full" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" step="0.5" min="0" value={editForm.hours}
                        onChange={(ev) => setEditForm((f) => ({ ...f, hours: ev.target.value }))}
                        className="border rounded px-2 py-1 text-xs w-20 text-right" />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <button onClick={saveEdit} disabled={saving}
                          className="p-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50" title="Guardar">
                          <Check size={13} />
                        </button>
                        <button onClick={cancelEdit}
                          className="p-1.5 rounded bg-gray-200 text-gray-600 hover:bg-gray-300" title="Cancelar">
                          <X size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  /* ── View row ── */
                  <tr key={e.id} className="border-t hover:bg-gray-50 group">
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: e.resource.color }} />
                        {e.resource.name}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: e.project.color }} />
                        {e.project.name}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{formatDateDisplay(e.date)}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatHours(e.hours)}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(e)}
                          className="p-1.5 rounded text-blue-500 hover:bg-blue-100" title="Editar">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => deleteEntry(e.id)} disabled={deletingId === e.id}
                          className="p-1.5 rounded text-red-500 hover:bg-red-100 disabled:opacity-40" title="Eliminar">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
              {entries.length === 0 && !isFetching && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-400">
                    No hay datos con los filtros seleccionados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="text-sm px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-100">
              ← Anterior
            </button>
            <span className="text-sm text-gray-600">Página {page} de {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
              className="text-sm px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-100">
              Siguiente →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab: Resumen ────────────────────────────────────────────────────────────

function TabResumen() {
  const [subView, setSubView] = useState<'resource' | 'project' | 'month'>('resource')
  const [month, setMonth] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const filterParams = new URLSearchParams({
    ...(month ? { month } : {}),
    ...((!month && dateFrom) ? { dateFrom } : {}),
    ...((!month && dateTo) ? { dateTo } : {}),
  })

  const { data: byResource } = useQuery<TimeEntryByResource[]>({
    queryKey: ['time-entries', 'by-resource', month, dateFrom, dateTo],
    queryFn: () => fetch(`/api/time-entries?view=by-resource&${filterParams}`).then((r) => r.json()),
  })
  const { data: byProject } = useQuery<TimeEntryByProject[]>({
    queryKey: ['time-entries', 'by-project', month, dateFrom, dateTo],
    queryFn: () => fetch(`/api/time-entries?view=by-project&${filterParams}`).then((r) => r.json()),
  })
  const { data: byMonth } = useQuery<TimeEntryByMonth[]>({
    queryKey: ['time-entries', 'by-month'],
    queryFn: () => fetch('/api/time-entries?view=by-month').then((r) => r.json()),
  })

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap gap-3 items-center">
        <span className="text-sm text-gray-600 font-medium">Filtrar por:</span>
        <input
          type="month"
          value={month}
          onChange={(e) => { setMonth(e.target.value); setDateFrom(''); setDateTo('') }}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={dateFrom}
          disabled={!!month}
          onChange={(e) => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm disabled:opacity-40"
        />
        <input
          type="date"
          value={dateTo}
          disabled={!!month}
          onChange={(e) => setDateTo(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm disabled:opacity-40"
        />
        {(month || dateFrom || dateTo) && (
          <button
            onClick={() => { setMonth(''); setDateFrom(''); setDateTo('') }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            × Limpiar
          </button>
        )}
      </div>

      {/* Sub-view tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { key: 'resource', label: 'Por Persona' },
          { key: 'project', label: 'Por Proyecto' },
          { key: 'month', label: 'Por Mes' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setSubView(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              subView === t.key ? 'bg-white text-[#0170B9] shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tables */}
      {subView === 'resource' && (
        <SummaryTable
          data={(byResource ?? []).map((r) => ({
            label: r.resourceName,
            color: r.resourceColor,
            hours: r.totalHours,
          }))}
          label="Persona"
        />
      )}
      {subView === 'project' && (
        <SummaryTable
          data={(byProject ?? []).map((p) => ({
            label: p.projectName,
            color: p.projectColor,
            hours: p.totalHours,
          }))}
          label="Proyecto"
        />
      )}
      {subView === 'month' && (
        <SummaryTable
          data={(byMonth ?? []).map((m) => ({
            label: formatMonth(m.month),
            color: '#0170B9',
            hours: m.totalHours,
          }))}
          label="Mes"
        />
      )}
    </div>
  )
}

function SummaryTable({ data, label }: { data: { label: string; color: string; hours: number }[]; label: string }) {
  const total = data.reduce((sum, d) => sum + d.hours, 0)
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#0170B9] text-white">
          <tr>
            <th className="px-4 py-2 text-left">{label}</th>
            <th className="px-4 py-2 text-right">Horas</th>
            <th className="px-4 py-2 text-right">% del total</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-t hover:bg-gray-50">
              <td className="px-4 py-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                  {row.label}
                </span>
              </td>
              <td className="px-4 py-2 text-right font-medium">{formatHours(row.hours)}</td>
              <td className="px-4 py-2 text-right text-gray-500">
                {total > 0 ? ((row.hours / total) * 100).toFixed(1) : 0}%
              </td>
            </tr>
          ))}
          <tr className="border-t bg-gray-50 font-semibold">
            <td className="px-4 py-2">Total</td>
            <td className="px-4 py-2 text-right text-[#0170B9]">{formatHours(total)}</td>
            <td className="px-4 py-2 text-right">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ─── Tab: Gráficos ───────────────────────────────────────────────────────────

function TabGraficos() {
  const { data: byResource } = useQuery<TimeEntryByResource[]>({
    queryKey: ['time-entries', 'by-resource-chart'],
    queryFn: () => fetch('/api/time-entries?view=by-resource').then((r) => r.json()),
  })
  const { data: byProject } = useQuery<TimeEntryByProject[]>({
    queryKey: ['time-entries', 'by-project-chart'],
    queryFn: () => fetch('/api/time-entries?view=by-project').then((r) => r.json()),
  })
  const { data: byMonth } = useQuery<TimeEntryByMonth[]>({
    queryKey: ['time-entries', 'by-month-chart'],
    queryFn: () => fetch('/api/time-entries?view=by-month').then((r) => r.json()),
  })

  const topProjects = (byProject ?? []).slice(0, 12)
  const topResources = (byResource ?? []).slice(0, 12)
  const monthData = (byMonth ?? []).map((m) => ({ ...m, name: formatMonth(m.month) }))

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* Bar: Horas por Proyecto */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-700 mb-4">Horas por Proyecto</h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={topProjects} layout="vertical" margin={{ left: 120, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="projectName" tick={{ fontSize: 11 }} width={115} />
            <Tooltip formatter={(v) => [`${formatHours(Number(v))} hs`, 'Horas']} />
            <Bar dataKey="totalHours" radius={[0, 4, 4, 0]}>
              {topProjects.map((p, i) => (
                <Cell key={i} fill={p.projectColor} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Bar: Horas por Persona */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-700 mb-4">Horas por Persona</h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={topResources} margin={{ bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="resourceName" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => [`${formatHours(Number(v))} hs`, 'Horas']} />
            <Bar dataKey="totalHours" radius={[4, 4, 0, 0]}>
              {topResources.map((r, i) => (
                <Cell key={i} fill={r.resourceColor} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Line: Evolución mensual */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-700 mb-4">Evolución Mensual</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={monthData} margin={{ bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => [`${formatHours(Number(v))} hs`, 'Horas']} />
            <Line
              type="monotone"
              dataKey="totalHours"
              stroke="#0170B9"
              strokeWidth={2}
              dot={{ r: 3, fill: '#0170B9' }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Pie: Distribución por Proyecto */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-700 mb-4">Distribución por Proyecto</h3>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={topProjects}
              dataKey="totalHours"
              nameKey="projectName"
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
            >
              {topProjects.map((p, i) => (
                <Cell key={i} fill={p.projectColor} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => [`${formatHours(Number(v))} hs`, 'Horas']} />
            <Legend
              formatter={(value: string) => <span style={{ fontSize: 11 }}>{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}


// ─── Main Page ───────────────────────────────────────────────────────────────

type Tab = 'import' | 'table' | 'summary' | 'charts'

const TABS: { key: Tab; label: string }[] = [
  { key: 'import',  label: 'Importar' },
  { key: 'table',   label: 'Tabla' },
  { key: 'summary', label: 'Resumen' },
  { key: 'charts',  label: 'Gráficos' },
]

export default function HoursPage() {
  const [activeTab, setActiveTab] = useState<Tab>('import')

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#3a3a3a]">Reporte de Horas</h1>
        <p className="text-sm text-gray-500 mt-1">
          Importación y consulta de horas trabajadas por persona y proyecto
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-[#0170B9] text-[#0170B9]'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'import'  && <TabImport />}
      {activeTab === 'table'   && <TabTabla />}
      {activeTab === 'summary' && <TabResumen />}
      {activeTab === 'charts'  && <TabGraficos />}
    </div>
  )
}
