'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { PROJECT_PALETTE, RESOURCE_PROFILES } from '@/types'
import type { Project, Resource, ProjectResourceRate, Task } from '@/types'

const schema = z.object({
  name: z.string().min(1, 'Requerido'),
  color: z.string().min(1),
  status: z.string().min(1),
  priority: z.string().min(1),
  projectType: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  estimatedHours: z.coerce.number().min(1),
  costPerHour: z.coerce.number().min(0),
  budgetHours: z.string().optional(),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  editProject?: Project | null
}

export default function ProjectModal({ open, onClose, editProject }: Props) {
  const qc = useQueryClient()
  const [resourceRates, setResourceRates] = useState<ProjectResourceRate[]>([])
  const [newTaskName, setNewTaskName] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      color: '#2E75B6',
      status: 'En ejecución',
      priority: 'Alta',
      projectType: 'fixed',
      costPerHour: 0,
      notes: '',
    },
  })

  const selectedColor = watch('color')

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ['resources'],
    queryFn: () => fetch('/api/resources').then((r) => r.json()),
    enabled: open,
  })

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['tasks', editProject?.id],
    queryFn: () => fetch(`/api/tasks?projectId=${editProject!.id}`).then((r) => r.json()),
    enabled: open && !!editProject,
  })

  async function addTask() {
    if (!newTaskName.trim() || !editProject) return
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: editProject.id, name: newTaskName.trim() }),
    })
    setNewTaskName('')
    qc.invalidateQueries({ queryKey: ['tasks', editProject.id] })
  }

  async function toggleTaskActive(task: Task) {
    await fetch(`/api/tasks/${task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !task.active }),
    })
    qc.invalidateQueries({ queryKey: ['tasks', editProject?.id] })
  }

  async function deleteTask(task: Task) {
    if (!confirm(`¿Eliminar la tarea "${task.name}"? Las horas ya cargadas contra ella no se pierden.`)) return
    await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['tasks', editProject?.id] })
  }

  useEffect(() => {
    if (editProject) {
      reset({
        name: editProject.name,
        color: editProject.color,
        status: editProject.status,
        priority: editProject.priority,
        projectType: editProject.projectType ?? 'fixed',
        startDate: editProject.startDate.split('T')[0],
        endDate: editProject.endDate.split('T')[0],
        estimatedHours: editProject.estimatedHours,
        costPerHour: editProject.costPerHour,
        budgetHours: editProject.budgetHours != null ? String(editProject.budgetHours) : '',
        notes: editProject.notes,
      })
      // Load existing resource rates
      fetch(`/api/projects/${editProject.id}/resource-rates`)
        .then((r) => r.json())
        .then(setResourceRates)
        .catch(() => setResourceRates([]))
    } else {
      reset({ color: '#2E75B6', status: 'En ejecución', priority: 'Alta', projectType: 'fixed', costPerHour: 0, notes: '' })
      setResourceRates([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editProject, open])

  function addRate() {
    setResourceRates((prev) => [
      ...prev,
      { projectId: editProject?.id ?? 0, resourceId: 0, profile: 'Developer', ratePerHour: 0, billable: true },
    ])
  }

  function removeRate(i: number) {
    setResourceRates((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateRate(i: number, field: string, value: unknown) {
    setResourceRates((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  const onSubmit = async (data: FormData) => {
    const url = editProject ? `/api/projects/${editProject.id}` : '/api/projects'
    const method = editProject ? 'PUT' : 'POST'
    const payload = {
      ...data,
      budgetHours: data.budgetHours === '' || data.budgetHours == null ? null : Number(data.budgetHours),
    }
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const saved = await res.json()
      const projectId = saved.id ?? editProject!.id
      const validRates = resourceRates.filter((r) => r.resourceId !== 0)
      // Always save rates when editing (empty list clears them), save when creating if non-empty
      if (editProject || validRates.length > 0) {
        await fetch(`/api/projects/${projectId}/resource-rates`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validRates.map((r) => ({ ...r, projectId }))),
        })
      }
      qc.invalidateQueries({ queryKey: ['gantt'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      onClose()
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-lg">{editProject ? 'Editar' : 'Nuevo'} Proyecto</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">Nombre *</label>
            <input {...register('name')} className="w-full border rounded px-3 py-2 text-sm" />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
          </div>

          {/* Color palette */}
          <div>
            <label className="block text-sm font-medium mb-1">Color *</label>
            <div className="flex flex-wrap gap-2">
              {PROJECT_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setValue('color', c)}
                  style={{ backgroundColor: c }}
                  className={`w-8 h-8 rounded-full border-4 transition-all ${
                    selectedColor === c ? 'border-gray-800 scale-110' : 'border-transparent'
                  }`}
                />
              ))}
            </div>
            <input type="hidden" {...register('color')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Status */}
            <div>
              <label className="block text-sm font-medium mb-1">Estado *</label>
              <select {...register('status')} className="w-full border rounded px-3 py-2 text-sm">
                {['En ejecución', 'Próximo', 'En planificación', 'Continuo', 'Finalizado', 'No Facturable'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            {/* Priority */}
            <div>
              <label className="block text-sm font-medium mb-1">Prioridad *</label>
              <select {...register('priority')} className="w-full border rounded px-3 py-2 text-sm">
                {['Alta', 'Media', 'Baja'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Project type */}
          <div>
            <label className="block text-sm font-medium mb-1">Tipo de proyecto</label>
            <select {...register('projectType')} className="w-full border rounded px-3 py-2 text-sm">
              <option value="fixed">Precio Fijo</option>
              <option value="t&m">Time &amp; Materials (T&M)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Fecha inicio *</label>
              <input type="date" {...register('startDate')} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Fecha fin *</label>
              <input type="date" {...register('endDate')} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Horas estimadas *</label>
              <input type="number" {...register('estimatedHours')} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Costo por hora (USD)</label>
              <input type="number" step="0.01" {...register('costPerHour')} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Presupuesto horas facturables</label>
            <input
              type="number"
              min="0"
              step="1"
              placeholder="Dejar vacío = sin límite (∞)"
              {...register('budgetHours')}
              className="w-full border rounded px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">Vacío = sin límite · 0 = no facturable</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notas</label>
            <textarea {...register('notes')} rows={2} className="w-full border rounded px-3 py-2 text-sm" />
          </div>

          {/* Resource billing rates */}
          <div className="border rounded-lg p-3 bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">Tarifas de recursos</label>
              <button
                type="button"
                onClick={addRate}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                + Agregar recurso
              </button>
            </div>
            {resourceRates.length === 0 ? (
              <p className="text-xs text-gray-400">Sin tarifas configuradas</p>
            ) : (
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-1.5 text-xs text-gray-500 font-medium px-1">
                  <span>Recurso</span>
                  <span className="w-28">Perfil</span>
                  <span className="w-20 text-center">USD/h</span>
                  <span className="w-6 text-center" title="Facturable">✓</span>
                  <span className="w-5" />
                </div>
                {resourceRates.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-1.5 items-center">
                    <select
                      value={r.resourceId}
                      onChange={(e) => updateRate(i, 'resourceId', Number(e.target.value))}
                      className="border rounded px-2 py-1 text-xs bg-white"
                    >
                      <option value={0}>Seleccionar...</option>
                      {resources.map((res) => (
                        <option key={res.id} value={res.id}>{res.name}</option>
                      ))}
                    </select>
                    <select
                      value={r.profile}
                      onChange={(e) => updateRate(i, 'profile', e.target.value)}
                      className="w-28 border rounded px-2 py-1 text-xs bg-white"
                    >
                      {RESOURCE_PROFILES.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0"
                      value={r.ratePerHour}
                      onChange={(e) => updateRate(i, 'ratePerHour', Number(e.target.value))}
                      className="w-20 border rounded px-2 py-1 text-xs"
                    />
                    <input
                      type="checkbox"
                      checked={r.billable}
                      onChange={(e) => updateRate(i, 'billable', e.target.checked)}
                      title="Facturable"
                      className="w-4 h-4 rounded"
                    />
                    <button
                      type="button"
                      onClick={() => removeRate(i)}
                      className="w-5 text-red-400 hover:text-red-600 text-sm leading-none"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-2">Tarifa 0 = sin costo · Desmarcar ✓ = no facturable</p>
          </div>

          {/* Tasks (for self-service time tracking) */}
          <div className="border rounded-lg p-3 bg-gray-50">
            <label className="block text-sm font-medium text-gray-700 mb-2">Tareas</label>
            {!editProject ? (
              <p className="text-xs text-gray-400">Guardá el proyecto primero para poder agregarle tareas.</p>
            ) : (
              <>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newTaskName}
                    onChange={(e) => setNewTaskName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTask() } }}
                    placeholder="Nombre de la tarea"
                    className="flex-1 border rounded px-2 py-1.5 text-xs bg-white"
                  />
                  <button
                    type="button"
                    onClick={addTask}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2"
                  >
                    + Agregar
                  </button>
                </div>
                {tasks.length === 0 ? (
                  <p className="text-xs text-gray-400">Sin tareas configuradas</p>
                ) : (
                  <div className="space-y-1">
                    {tasks.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-xs bg-white border rounded px-2 py-1.5">
                        <span className={`flex-1 ${t.active ? '' : 'text-gray-400 line-through'}`}>{t.name}</span>
                        <button
                          type="button"
                          onClick={() => toggleTaskActive(t)}
                          className="text-gray-400 hover:text-gray-700"
                          title={t.active ? 'Desactivar' : 'Activar'}
                        >
                          {t.active ? '●' : '○'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTask(t)}
                          className="text-red-400 hover:text-red-600"
                          title="Eliminar"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm hover:bg-gray-50">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#4472C4] text-white rounded text-sm hover:bg-[#2E75B6] disabled:opacity-50"
            >
              {isSubmitting ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
