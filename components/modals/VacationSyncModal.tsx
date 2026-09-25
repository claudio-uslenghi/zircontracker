'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import type { SyncOutcome } from '@/lib/vacation-sync-run'

interface Props {
  open: boolean
  onClose: () => void
}

function Counter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-center ${tone}`}>
      <div className="text-lg font-bold leading-none">{value}</div>
      <div className="text-[11px] mt-1">{label}</div>
    </div>
  )
}

function Section({ title, tone, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone}`}>
      <p className="text-xs font-semibold mb-1">{title}</p>
      <div className="max-h-32 overflow-y-auto text-xs space-y-0.5">{children}</div>
    </div>
  )
}

const range = (s: string, e: string) => (s === e ? s : `${s} → ${e}`)

export default function VacationSyncModal({ open, onClose }: Props) {
  const qc = useQueryClient()
  const [preview, setPreview] = useState<SyncOutcome | null>(null)
  const [result, setResult] = useState<SyncOutcome | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [confirmDeletes, setConfirmDeletes] = useState(false)

  const request = useCallback(async (dryRun: boolean, allowLargeDeletes = false): Promise<SyncOutcome> => {
    const res = await fetch('/api/vacations/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun, allowLargeDeletes }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'No se pudo leer la planilla')
    return data
  }, [])

  const loadPreview = useCallback(async () => {
    setLoading(true); setError(''); setPreview(null); setResult(null); setConfirmDeletes(false)
    try {
      setPreview(await request(true))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [request])

  useEffect(() => {
    if (open) loadPreview()
  }, [open, loadPreview])

  if (!open) return null

  const c = preview?.counts
  const pendingChanges = c ? c.create + c.update + c.adopt + c.delete : 0
  const needsDeleteConfirm = !!preview && preview.delete.length > 0 && preview.deleteBlocked

  const apply = async () => {
    setApplying(true); setError('')
    try {
      const outcome = await request(false, confirmDeletes)
      setResult(outcome)
      setPreview(null)
      qc.invalidateQueries({ queryKey: ['vacations'] })
      qc.invalidateQueries({ queryKey: ['gantt'] })
      qc.invalidateQueries({ queryKey: ['vacation-sync-last'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-lg font-semibold text-gray-800">Sincronizar con Google Sheet</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600 p-1">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          <p className="text-xs text-gray-500">
            Se lee la planilla de vacaciones y se muestra qué cambiaría en la base. Las vacaciones cargadas a mano nunca se modifican.
          </p>

          {loading && <p className="text-sm text-gray-500 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Leyendo la planilla…</p>}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {preview && c && (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <Counter label="A crear" value={c.create} tone="bg-green-50 text-green-700" />
                <Counter label="A actualizar" value={c.update} tone="bg-blue-50 text-blue-700" />
                <Counter label="Ya cargadas" value={c.adopt} tone="bg-indigo-50 text-indigo-700" />
                <Counter label="A borrar" value={c.delete} tone="bg-red-50 text-red-700" />
                <Counter label="Sin cambios" value={c.unchanged} tone="bg-gray-100 text-gray-600" />
                <Counter label="Sin match" value={c.unmatched} tone="bg-amber-50 text-amber-700" />
              </div>

              {preview.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700 flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}</p>
              ))}

              {preview.create.length > 0 && (
                <Section title={`Se van a crear (${preview.create.length})`} tone="border-green-200 bg-green-50/40 text-green-900">
                  {preview.create.map((r) => (
                    <div key={r.rowNumber}>{r.resourceName} · {range(r.startDate, r.endDate)} · {r.type}{r.halfDay ? ' (½ día)' : ''}</div>
                  ))}
                </Section>
              )}
              {preview.update.length > 0 && (
                <Section title={`Se van a actualizar (${preview.update.length})`} tone="border-blue-200 bg-blue-50/40 text-blue-900">
                  {preview.update.map((r, i) => (
                    <div key={i}>{r.resourceName} · {range(r.startDate, r.endDate)} · cambia: {r.changes.join(', ')}</div>
                  ))}
                </Section>
              )}
              {preview.delete.length > 0 && (
                <Section title={`Se van a borrar (${preview.delete.length}) — ya no están en la planilla`} tone="border-red-200 bg-red-50/40 text-red-900">
                  {preview.delete.map((r, i) => (
                    <div key={i}>{r.resourceName} · {range(r.startDate, r.endDate)}</div>
                  ))}
                </Section>
              )}
              {preview.unmatched.length > 0 && (
                <Section title="Sin recurso asociado (se omiten) — cargá ese mail en el Recurso correspondiente" tone="border-amber-200 bg-amber-50/40 text-amber-900">
                  {preview.unmatched.map((u) => (
                    <div key={u.email}>{u.email} · fila(s) {u.rowNumbers.join(', ')}</div>
                  ))}
                </Section>
              )}
              {preview.errors.length > 0 && (
                <Section title="Filas con errores (se omiten)" tone="border-red-200 bg-red-50/40 text-red-900">
                  {preview.errors.map((e, i) => (
                    <div key={i}>Fila {e.rowNumber} · {e.email} · {e.message}</div>
                  ))}
                </Section>
              )}

              {needsDeleteConfirm && (
                <label className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <input type="checkbox" className="mt-1" checked={confirmDeletes} onChange={(e) => setConfirmDeletes(e.target.checked)} />
                  Son muchos borrados de una vez (el sync automático los frenaría). Confirmo borrar {preview.delete.length} vacaciones.
                </label>
              )}
              {pendingChanges === 0 && <p className="text-sm text-gray-500">La base ya está al día con la planilla.</p>}
            </>
          )}

          {result && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-start gap-3">
              <CheckCircle2 size={18} className="text-green-600 shrink-0 mt-0.5" />
              <div className="text-sm text-green-800">
                <p className="font-medium">¡Sincronización aplicada!</p>
                <p>{result.counts.create} creadas · {result.counts.update} actualizadas · {result.counts.adopt} vinculadas · {result.deleteBlocked ? 0 : result.counts.delete} borradas</p>
                {result.deleteBlocked && <p className="text-amber-700">Se omitieron {result.counts.delete} borrados (sin confirmar).</p>}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{result ? 'Cerrar' : 'Cancelar'}</button>
          {!result && (
            <button
              onClick={apply}
              disabled={!preview || pendingChanges === 0 || applying || (needsDeleteConfirm && !confirmDeletes)}
              className="px-4 py-2 text-sm bg-[#0170B9] text-white rounded-lg hover:bg-[#005a94] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {applying ? 'Aplicando…' : `Aplicar cambios${pendingChanges ? ` (${pendingChanges})` : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
