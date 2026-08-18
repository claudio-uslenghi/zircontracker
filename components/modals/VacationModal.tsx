'use client'

import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { eachDayOfInterval, isWeekend, parseISO } from 'date-fns'
import type { Resource } from '@/types'

const schema = z.object({
  // Optional here: when lockedResource is set, resourceId never comes from
  // the form (no field is registered for it) — onSubmit fills it in from
  // the prop instead. Required only for the admin picker path.
  resourceId: z.coerce.number().optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  // When set (self-service, non-admin), the resource picker is hidden and
  // every submission is locked to this resourceId — the resource picker is
  // for admins managing anyone's vacations.
  lockedResource?: { id: number; name: string }
}

export default function VacationModal({ open, onClose, lockedResource }: Props) {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ['resources'],
    queryFn: () => fetch('/api/resources').then((r) => r.json()),
    enabled: !lockedResource,
  })

  const { register, handleSubmit, reset, watch, formState: { isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const [start, end] = watch(['startDate', 'endDate'])

  const workingDays = useMemo(() => {
    if (!start || !end) return 0
    try {
      return eachDayOfInterval({ start: parseISO(start), end: parseISO(end) }).filter((d) => !isWeekend(d)).length
    } catch { return 0 }
  }, [start, end])

  const onSubmit = async (data: FormData) => {
    setError('')
    const resourceId = lockedResource ? lockedResource.id : data.resourceId
    if (!resourceId) {
      setError('Seleccioná un recurso.')
      return
    }
    const res = await fetch('/api/vacations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceId, startDate: data.startDate, endDate: data.endDate, notes: data.notes }),
    })
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['vacations'] })
      qc.invalidateQueries({ queryKey: ['gantt'] })
      reset()
      onClose()
    } else {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'No se pudo guardar la vacación.')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-lg">Agregar Vacaciones</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          {!lockedResource && (
            <div>
              <label className="block text-sm font-medium mb-1">Recurso *</label>
              <select {...register('resourceId')} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Seleccionar...</option>
                {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Desde *</label>
              <input type="date" {...register('startDate')} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Hasta *</label>
              <input type="date" {...register('endDate')} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
          </div>
          {workingDays > 0 && (
            <p className="text-blue-600 text-sm">{workingDays} días hábiles afectados</p>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Notas</label>
            <input {...register('notes')} className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[#4472C4] text-white rounded text-sm hover:bg-[#2E75B6] disabled:opacity-50">
              {isSubmitting ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
