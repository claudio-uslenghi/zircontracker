'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { COUNTRIES } from '@/lib/countries'
import type { CountryHoliday } from '@/types'

const CUSTOM_COUNTRY = '__custom__'

const schema = z.object({
  country: z.string().min(1),
  date: z.string().min(1),
  name: z.string().min(1),
})

type FormData = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  editHoliday?: CountryHoliday | null
}

export default function HolidayModal({ open, onClose, editHoliday }: Props) {
  const qc = useQueryClient()
  const isEdit = !!editHoliday
  // El backend ya acepta cualquier string de país (sin whitelist) — el combo
  // ofrece los países conocidos para elegir rápido, pero permite escribir
  // uno nuevo (ej. un país sin feriados cargados todavía) en vez de quedar
  // bloqueado a la lista fija de lib/countries.ts.
  const [customCountry, setCustomCountry] = useState(false)

  const { register, handleSubmit, reset, setValue, formState: { isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (editHoliday) {
      const known = COUNTRIES.some((c) => c.name === editHoliday.country)
      setCustomCountry(!known)
      reset({
        country: editHoliday.country,
        date: editHoliday.date.substring(0, 10),
        name: editHoliday.name,
      })
    } else {
      setCustomCountry(false)
      reset({ country: '', date: '', name: '' })
    }
  }, [editHoliday, open, reset])

  const onSubmit = async (data: FormData) => {
    let res: Response
    if (isEdit && editHoliday) {
      // Build noon UTC date to avoid timezone shift
      const [y, m, d] = data.date.split('-').map(Number)
      const isoDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toISOString()
      res = await fetch(`/api/country-holidays/${editHoliday.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name, date: isoDate }),
      })
    } else {
      res = await fetch('/api/country-holidays/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holidays: [{ country: data.country, date: data.date, name: data.name }],
        }),
      })
    }
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['country-holidays'] })
      qc.invalidateQueries({ queryKey: ['holidays'] })
      qc.invalidateQueries({ queryKey: ['gantt'] })
      reset()
      onClose()
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-lg">{isEdit ? 'Editar Feriado' : 'Agregar Feriado'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">País *</label>
            {customCountry || isEdit ? (
              <div className="flex items-center gap-2">
                <input
                  {...register('country')}
                  disabled={isEdit}
                  placeholder="Nombre del país"
                  className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
                {!isEdit && (
                  <button
                    type="button"
                    onClick={() => { setCustomCountry(false); setValue('country', '') }}
                    className="text-xs text-gray-500 hover:text-gray-700 whitespace-nowrap"
                  >
                    Elegir de la lista
                  </button>
                )}
              </div>
            ) : (
              <select
                disabled={isEdit}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value === CUSTOM_COUNTRY) {
                    setCustomCountry(true)
                    setValue('country', '')
                  } else {
                    setValue('country', e.target.value)
                  }
                }}
                className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="">Seleccionar...</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.name}>{c.flag} {c.name}</option>
                ))}
                <option value={CUSTOM_COUNTRY}>+ Otro país (escribir)</option>
              </select>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Fecha *</label>
            <input type="date" {...register('date')} className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Nombre del feriado *</label>
            <input {...register('name')} placeholder="ej: Día de la Memoria" className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[#0170B9] text-white rounded text-sm hover:bg-[#005a94] disabled:opacity-50">
              {isSubmitting ? 'Guardando...' : isEdit ? 'Actualizar' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
