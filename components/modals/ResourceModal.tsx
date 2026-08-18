'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import type { Resource } from '@/types'
import { COUNTRIES } from '@/lib/countries'

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  country: z.string().min(1),
  color: z.string().min(1),
  capacityH: z.coerce.number().min(1).max(24),
})

type FormData = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  editResource?: Resource | null
}

export default function ResourceModal({ open, onClose, editResource }: Props) {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const { register, handleSubmit, reset, watch, formState: { isSubmitting, errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { color: '#4472C4', capacityH: 8, country: 'Argentina' },
  })

  const country = watch('country')

  useEffect(() => {
    if (editResource) {
      reset({
        name: editResource.name,
        email: editResource.email ?? '',
        country: editResource.country,
        color: editResource.color,
        capacityH: editResource.capacityH,
      })
    } else {
      reset({ color: '#4472C4', capacityH: 8, country: 'Argentina' })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editResource, open])

  const onSubmit = async (data: FormData) => {
    setError('')
    const url = editResource ? `/api/resources/${editResource.id}` : '/api/resources'
    const method = editResource ? 'PUT' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (res.ok) {
      await res.json()
      qc.invalidateQueries({ queryKey: ['resources'] })
      qc.invalidateQueries({ queryKey: ['gantt'] })
      qc.invalidateQueries({ queryKey: ['holidays'] })
      onClose()
    } else {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'No se pudo guardar el recurso.')
    }
  }

  const loadHolidays = async () => {
    if (!editResource) return
    const res = await fetch(`/api/resources/${editResource.id}/sync-holidays`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country }),
    })
    if (res.ok) {
      const { synced } = await res.json()
      qc.invalidateQueries({ queryKey: ['gantt'] })
      qc.invalidateQueries({ queryKey: ['holidays'] })
      alert(`${synced} feriados cargados para ${country}`)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-lg">{editResource ? 'Editar' : 'Nuevo'} Recurso</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nombre *</label>
            <input {...register('name')} className="w-full border rounded px-3 py-2 text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              {...register('email')}
              placeholder="Para carga de horas self-service (opcional)"
              className="w-full border rounded px-3 py-2 text-sm"
            />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            <p className="text-xs text-gray-400 mt-1">
              Si coincide con el email de un usuario, esa persona podrá cargar sus propias horas.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">País *</label>
            <select {...register('country')} className="w-full border rounded px-3 py-2 text-sm">
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.name}>
                  {c.flag} {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Color</label>
            <input type="color" {...register('color')} className="w-16 h-10 border rounded cursor-pointer" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Capacidad (h/día)</label>
            <input type="number" min="1" max="24" {...register('capacityH')} className="w-full border rounded px-3 py-2 text-sm" />
          </div>

          {editResource && (
            <button
              type="button"
              onClick={loadHolidays}
              className="w-full text-sm px-3 py-2 bg-amber-50 border border-amber-300 text-amber-700 rounded hover:bg-amber-100"
            >
              📅 Cargar feriados de {country}
            </button>
          )}

          {error && <p className="text-red-500 text-sm">{error}</p>}
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
