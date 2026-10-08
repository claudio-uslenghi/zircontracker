'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, AlertTriangle, CheckCircle2, RefreshCw, Send } from 'lucide-react'
import { confirmDialog } from '@/lib/confirm-dialog'
import type { HolidaysBotOutcome } from '@/lib/holidays-bot-send'

interface Props {
  open: boolean
  onClose: () => void
}

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export default function HolidaysBotModal({ open, onClose }: Props) {
  const qc = useQueryClient()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [preview, setPreview] = useState<HolidaysBotOutcome | null>(null)
  const [result, setResult] = useState<HolidaysBotOutcome | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [imgKey, setImgKey] = useState(0)
  // Qué países van en el envío — todos marcados por defecto al cargar el
  // preview (incluidos los que no tienen ningún recurso hoy, como Yemen);
  // el admin destilda lo que no quiera mandar. El cron automático no pasa
  // por acá — usa la lista de "Envío automático".
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set())

  const request = useCallback(
    async (dryRun: boolean, countries?: string[]): Promise<HolidaysBotOutcome> => {
      const res = await fetch('/api/holidays-bot/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, dryRun, selectedCountries: countries }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo generar el resumen')
      return data
    },
    [year, month]
  )

  const loadPreview = useCallback(async () => {
    setLoading(true); setError(''); setResult(null)
    try {
      const outcome = await request(true, Array.from(selectedCountries))
      setPreview(outcome)
      setImgKey((k) => k + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [request, selectedCountries])

  // Al abrir (o cambiar mes/año), se re-arranca la selección a "todos" y se
  // pide un preview fresco sin selección explícita (el server default es
  // "todos los países del mes" para el preview).
  const loadFreshPreview = useCallback(async () => {
    setLoading(true); setError(''); setPreview(null); setResult(null)
    try {
      const outcome = await request(true)
      setPreview(outcome)
      setSelectedCountries(new Set(outcome.data.countries.map((c) => c.country)))
      setImgKey((k) => k + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [request])

  useEffect(() => {
    if (open) loadFreshPreview()
  }, [open, loadFreshPreview])

  if (!open) return null

  const toggleCountry = (country: string) => {
    setSelectedCountries((prev) => {
      const next = new Set(prev)
      if (next.has(country)) next.delete(country)
      else next.add(country)
      return next
    })
  }

  const send = async () => {
    const ok = await confirmDialog({
      title: `¿Enviar el resumen de ${MONTHS_ES[month - 1]} ${year} a Slack?`,
      description: `Se postea un mensaje real en el canal configurado, con ${selectedCountries.size} país(es). Esta acción no se puede deshacer.`,
    })
    if (!ok) return

    setSending(true); setError('')
    try {
      const outcome = await request(false, Array.from(selectedCountries))
      setResult(outcome)
      setPreview(null)
      qc.invalidateQueries({ queryKey: ['holidays-bot-last'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSending(false)
    }
  }

  const imageSrc = `/api/holidays-bot/image/${year}-${month}.png?countries=${encodeURIComponent(Array.from(selectedCountries).join(','))}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-lg font-semibold text-gray-800">Holidays Bot — resumen mensual a Slack</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600 p-1">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Mes</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                {MONTHS_ES.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Año</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24"
              />
            </div>
            <button
              onClick={loadPreview}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar preview
            </button>
          </div>

          <p className="text-xs text-gray-500">
            El preview genera la imagen y el texto sin tocar Slack, con los países tildados abajo.
            Siempre apunta al canal configurado en <code>SLACK_HOLIDAYS_CHANNEL_ID</code> (de prueba
            por ahora).
          </p>

          {loading && <p className="text-sm text-gray-500 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Generando preview…</p>}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {preview && (
            <>
              {preview.data.countries.length === 0 ? (
                <p className="text-sm text-gray-500">Sin feriados cargados para ningún país este mes.</p>
              ) : (
                <>
                  <div>
                    <p className="text-xs text-gray-500 font-medium mb-1.5">Países a incluir</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 border border-gray-200 rounded-lg p-3 bg-gray-50">
                      {preview.data.countries.map((c) => (
                        <label key={c.country} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedCountries.has(c.country)}
                            onChange={() => toggleCountry(c.country)}
                            className="rounded"
                          />
                          {c.flag} {c.country}
                          {!c.hasResource && <span className="text-amber-600 text-xs">(sin recursos hoy)</span>}
                        </label>
                      ))}
                    </div>
                  </div>

                  {selectedCountries.size === 0 ? (
                    <p className="text-sm text-gray-500">Ningún país tildado — no se va a enviar nada.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <pre className="text-xs whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-lg p-3 font-sans">{preview.text}</pre>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        key={imgKey}
                        src={imageSrc}
                        alt={`Preview feriados ${MONTHS_ES[month - 1]} ${year}`}
                        className="w-full rounded-lg border border-gray-200"
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {result && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-start gap-3">
              <CheckCircle2 size={18} className="text-green-600 shrink-0 mt-0.5" />
              <div className="text-sm text-green-800">
                <p className="font-medium">{result.skipped ? 'Sin países seleccionados con feriados — no se envió nada.' : '¡Enviado a Slack!'}</p>
                {result.slackPermalink && (
                  <a href={result.slackPermalink} target="_blank" rel="noreferrer" className="underline">
                    Ver mensaje en Slack
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{result ? 'Cerrar' : 'Cancelar'}</button>
          {!result && (
            <button
              onClick={send}
              disabled={!preview || selectedCountries.size === 0 || sending || loading}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#0170B9] text-white rounded-lg hover:bg-[#005a94] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={14} /> {sending ? 'Enviando…' : 'Enviar ahora'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
