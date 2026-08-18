export interface Resource {
  id: number
  name: string
  email: string | null
  country: string
  color: string
  capacityH: number
  createdAt: string
}

export interface Project {
  id: number
  name: string
  color: string
  status: string
  priority: string
  startDate: string
  endDate: string
  estimatedHours: number
  costPerHour: number
  budgetHours: number | null
  projectType: string
  notes: string
  createdAt: string
}

export interface Assignment {
  id: number
  projectId: number
  resourceId: number
  moduleName: string
  percentage: number
  startDate: string
  endDate: string
  estimatedHours: number
  project?: Project
  resource?: Resource
}

export interface Holiday {
  id: number
  resourceId: number
  date: string
  name: string
  resource?: Resource
}

export interface CountryHoliday {
  id: number
  country: string
  date: string
  name: string
}

export interface Vacation {
  id: number
  resourceId: number
  startDate: string
  endDate: string
  notes: string
  resource?: Resource
}

export interface GanttData {
  assignments: (Assignment & { project: Project; resource: Resource })[]
  holidays: Holiday[]
  vacations: Vacation[]
  resources: Resource[]
  projects: Project[]
}

export type CellType = 'weekend' | 'out-of-range' | 'holiday' | 'vacation' | 'active'

export interface CellData {
  type: CellType
  hours?: number
  label?: string
}

export interface Task {
  id: number
  projectId: number
  name: string
  active: boolean
  createdAt: string
}

export interface TimeEntry {
  id: number
  resourceId: number
  projectId: number
  taskId: number | null
  date: string
  hours: number
  entryType: string
  resource?: Pick<Resource, 'id' | 'name' | 'color'>
  project?: Pick<Project, 'id' | 'name' | 'color'>
  task?: Pick<Task, 'id' | 'name'> | null
}

export interface TimeEntryByResource {
  resourceId: number
  resourceName: string
  resourceColor: string
  totalHours: number
}

export interface TimeEntryByProject {
  projectId: number
  projectName: string
  projectColor: string
  totalHours: number
}

export interface TimeEntryByMonth {
  month: string
  totalHours: number
}

export interface ImportTimeEntriesResult {
  inserted: number
  updated: number
  skipped: number
  unmatchedResources: string[]
  unmatchedProjects: string[]
  errors: string[]
}

export interface ParsedTimeEntry {
  resourceName: string
  resourceEmail?: string   // optional: used by Clockify import for email-based matching
  projectName: string
  date: string
  hours: number
  entryType?: string       // "regular" | "extra" — optional, defaults to "regular"
}

export type ProjectStatus = 'En ejecución' | 'Próximo' | 'En planificación' | 'Continuo' | 'Finalizado' | 'No Facturable'
export type ProjectPriority = 'Alta' | 'Media' | 'Baja'
export type Country = 'Argentina' | 'Uruguay' | 'Chile' | 'Otro'

export const STATUS_COLORS: Record<string, string> = {
  'En ejecución': '#C6EFCE',
  'Próximo': '#FFEB9C',
  'En planificación': '#FFC7CE',
  'Continuo': '#FCE4D6',
  'Finalizado': '#E0E0E0',
  'No Facturable': '#F3F4F6',
}

export const RESOURCE_PROFILES = [
  'Developer', 'Senior Developer', 'Tester', 'DevOps', 'QA', 'PM',
  'Tech Lead', 'Designer', 'Analyst', 'Other',
]

export interface ProjectResourceRate {
  id?: number
  projectId: number
  resourceId: number
  profile: string
  ratePerHour: number
  billable: boolean
  resource?: Pick<Resource, 'id' | 'name' | 'color'>
}

export interface ResourceBillingBreakdown {
  resourceId: number
  resourceName: string
  resourceColor: string
  profile: string
  ratePerHour: number
  billable: boolean
  grossHours: number
  cost: number
}

export interface ControlHorasProject {
  projectId: number
  projectName: string
  projectColor: string
  projectStatus: string
  projectType: string
  budgetHours: number | null
  budgetIsEstimated: boolean
  monthlyGross: Record<string, number>
  monthlyBillable: Record<string, number>
  monthlyResources: Record<string, ResourceBillingBreakdown[]>
  totalGross: number
  totalBillable: number
  totalCost: number
  surplus: number
  status: 'ok' | 'warning' | 'exceeded' | 'unlimited' | 'no-billable'
}

export interface ControlHorasResponse {
  months: string[]
  projects: ControlHorasProject[]
}

export const PROJECT_PALETTE = [
  '#2E75B6', '#548235', '#C55A11', '#7030A0',
  '#0070C0', '#833C00', '#1F7391', '#7D3C98',
  '#BF8F00', '#C00000', '#375623', '#203864',
]
