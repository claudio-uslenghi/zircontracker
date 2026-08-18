'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  BarChart3,
  FolderKanban,
  Users,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Shield,
  UserCog,
  KeyRound,
  LogOut,
  ChevronDown,
  ChevronUp,
  Clock,
  TrendingUp,
  CalendarClock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession, signOut } from 'next-auth/react'

const NAV_ITEMS = [
  { href: '/gantt', icon: BarChart3, label: 'Gantt' },
  { href: '/projects', icon: FolderKanban, label: 'Proyectos' },
  { href: '/resources', icon: Users, label: 'Recursos' },
  { href: '/holidays', icon: CalendarDays, label: 'Feriados & Vacaciones' },
  { href: '/mis-horas', icon: Clock, label: 'Mis Horas' },
  { href: '/mi-reporte', icon: CalendarClock, label: 'Mi Reporte' },
]

const ADMIN_ITEMS = [
  { href: '/admin/users', icon: UserCog, label: 'Usuarios' },
  { href: '/admin/roles', icon: Shield, label: 'Roles' },
  { href: '/admin/permissions', icon: KeyRound, label: 'Permisos' },
  { href: '/admin/hours', icon: Clock, label: 'Reporte de Horas' },
  { href: '/admin/daily-report', icon: CalendarClock, label: 'Reporte Diario' },
  { href: '/admin/control-horas', icon: TrendingUp, label: 'Control de Horas' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [adminOpen, setAdminOpen] = useState(pathname.startsWith('/admin'))
  const { data: session } = useSession()

  const roles = (session?.user as { roles?: string[] })?.roles ?? []
  const isAdmin = roles.includes('admin')
  const allowedPages = (session?.user as { allowedPages?: string[] })?.allowedPages ?? []
  const userName = session?.user?.name ?? session?.user?.email ?? ''

  const visibleNavItems = isAdmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => allowedPages.includes(item.href))

  return (
    <aside
      className={cn(
        'h-screen text-white flex flex-col transition-all duration-300 shrink-0',
        collapsed ? 'w-16' : 'w-52'
      )}
      style={{ backgroundColor: '#0170B9' }}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/20">
        {!collapsed && (
          <div className="flex flex-col">
            <span className="font-bold text-sm leading-tight text-white tracking-wide">
              Zircon Planner
            </span>
            <span className="text-xs text-white/60 leading-tight">Zircon Tech</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto text-white/70 hover:text-white transition-colors p-1 rounded hover:bg-white/10"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 p-2 flex-1 overflow-y-auto">
        {visibleNavItems.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-all duration-150',
                isActive
                  ? 'bg-white/25 text-white font-semibold shadow-sm'
                  : 'text-white/75 hover:bg-white/15 hover:text-white'
              )}
            >
              <Icon size={17} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          )
        })}

        {/* Admin section */}
        {isAdmin && (
          <>
            {!collapsed && (
              <button
                onClick={() => setAdminOpen((o) => !o)}
                className="flex items-center justify-between px-3 py-2 mt-2 rounded text-xs text-white/60 hover:text-white/90 hover:bg-white/10 transition-all"
              >
                <span className="font-semibold tracking-wider uppercase">Administración</span>
                {adminOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            )}
            {collapsed && <div className="border-t border-white/20 mt-2 mb-1" />}

            {(adminOpen || collapsed) &&
              ADMIN_ITEMS.map(({ href, icon: Icon, label }) => {
                const isActive = pathname.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded text-sm transition-all duration-150',
                      collapsed ? '' : 'pl-5',
                      isActive
                        ? 'bg-white/25 text-white font-semibold shadow-sm'
                        : 'text-white/70 hover:bg-white/15 hover:text-white'
                    )}
                  >
                    <Icon size={15} className="shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </Link>
                )
              })}
          </>
        )}
      </nav>

      {/* User & logout */}
      <div className="p-3 border-t border-white/20">
        {!collapsed ? (
          <div className="flex items-center gap-2">
            <Link
              href="/perfil"
              className="flex items-center gap-2 flex-1 min-w-0 rounded px-1 py-1 -mx-1 hover:bg-white/10 transition-colors"
              title="Mi Perfil"
            >
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center shrink-0 text-xs font-bold uppercase">
                {userName.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">{userName}</p>
                <p className="text-xs text-white/50 truncate">
                  {roles.join(', ')}
                </p>
              </div>
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              title="Cerrar sesión"
              className="p-1.5 rounded hover:bg-white/15 text-white/70 hover:text-white transition-colors"
            >
              <LogOut size={15} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            title="Cerrar sesión"
            className="w-full flex justify-center p-1.5 rounded hover:bg-white/15 text-white/70 hover:text-white transition-colors"
          >
            <LogOut size={16} />
          </button>
        )}
      </div>
    </aside>
  )
}
