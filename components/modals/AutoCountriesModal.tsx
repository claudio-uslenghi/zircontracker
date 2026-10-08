'use client'

import { useCallback, useEffect, useState } from 'react'
import { X, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import type { AutoCountryRow } from '@/lib/holidays-bot-auto'

interface Props {
  open: boolean
  onClose: () => void
}

// Configuración del envío AUTOMÁTICO del Holidays Bot (cron del día 1).
// Separada del modal de envío manual a propósito: acá no se envía nada,
// solo se guarda a qué países avisa el bot cuando corre solo.
export default function AutoCountriesModal({ open, onClose }: Props) {
  const [rows, setRows] = useState<AutoCountryRow[]>([])
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [justSaved, setJustSaved] = useState(false)

  const apply = (list: AutoCountryRow[]) => {
    const enabled = new Set(list.filter((r) => r.enabled).map((r) => r.country))
    setRows(list)
    setSaved(enabled)
    setSelected(new Set(enabled))
  }

  const load = useCallback(async () => {
    setLoading(true); setError(''); setJustSaved(false)
    try {
      const res = await fetch('/api/holidays-bot/auto-countries')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo cargar la configuración')
      apply(data.countries)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  if (!open) return null

  const toggle = (country: string) => {
    setJustSaved(false)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(country)) next.delete(country)
      else next.add(country)
      return next
    })
  }

  const dirty = selected.size !== saved.size || Array.from(selected).some((c) => !saved.has(c))

  const save = async () => {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/holidays-bot/auto-countries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countries: Array.from(selected) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar')
      apply(data.countries)
      setJustSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="auto-countries-title">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 id="auto-countries-title" className="text-lg font-semibold text-gray-800">Envío automático — países</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600 p-2 -mr-2 min-h-[44px] min-w-[44px] flex items-center justify-center">
            <X size={20} />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-4 space-y-4 overflow-y-auto">
          <p className="text-sm text-gray-600">
            El día 1 de cada mes (09:00 hora de Argentina) el bot publica solo en Slack los feriados del mes
            de los países tildados. Un país que no esté tildado no se incluye. Esto no envía nada ahora; el
            envío manual se hace desde «Holidays Bot».
          </p>

          {loading && (
            <p className="text-sm text-gray-500 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Cargando…</p>
          )}

          {!loading && rows.length > 0 && (
            <>
              <div className="flex gap-4 text-sm">
                <button type="button" onClick={() => { setJustSaved(false); setSelected(new Set(rows.map((r) => r.country))) }} className="text-[#0170B9] hover:underline min-h-[44px]">
                  Tildar todos
                </button>
                <button type="button" onClick={() => { setJustSaved(false); setSelected(new Set()) }} className="text-[#0170B9] hover:underline min-h-[44px]">
                  Destildar todos
                </button>
              </div>
              <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {rows.map((r) => (
                  <li key={r.country}>
                    <label className="flex items-center gap-3 px-3 py-2 min-h-[44px] cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selected.has(r.country)}
                        onChange={() => toggle(r.country)}
                        className="rounded h-4 w-4"
                      />
                      <span aria-hidden="true">{r.flag}</span>
                      <span className="text-sm text-gray-800">{r.country}</span>
                      {!r.hasHolidays && <span className="text-xs text-amber-600">(sin feriados cargados aún)</span>}
                    </label>
                  </li>
                ))}
              </ul>
              {selected.size === 0 && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Ningún país tildado: el envío automático no va a publicar nada.
                </p>
              )}
            </>
          )}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-gray-500">No hay feriados cargados todavía.</p>
          )}
        </div>

        {/* Mensajes fuera del área con scroll: si no, en mobile quedan fuera de
            pantalla cuando se guarda con la lista scrolleada. */}
        {(error || justSaved) && (
          <div className="px-4 sm:px-6 pt-3 shrink-0 space-y-2">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-start gap-2 break-words" role="alert">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> <span className="min-w-0 break-words">{error}</span>
              </div>
            )}
            {justSaved && (
              <p className="text-sm text-green-700 flex items-center gap-2" role="status">
                <CheckCircle2 size={16} /> Guardado. El próximo envío automático usa esta lista.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 px-4 sm:px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 min-h-[44px]">Cerrar</button>
          <button
            onClick={save}
            disabled={!dirty || saving || loading}
            className="px-4 py-2 text-sm bg-[#0170B9] text-white rounded-lg hover:bg-[#005a94] disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[44px]"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
