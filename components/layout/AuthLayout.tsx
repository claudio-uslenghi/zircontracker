'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import Sidebar from '@/components/layout/Sidebar'

const NO_SIDEBAR_PATHS = ['/login', '/unauthorized']

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const showSidebar = !NO_SIDEBAR_PATHS.some((p) => pathname.startsWith(p))

  // Close the drawer automatically on route change (nav links also call
  // onClose directly, this covers back/forward navigation too).
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  if (!showSidebar) {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 -ml-1.5 rounded hover:bg-gray-100 text-gray-600"
            aria-label="Abrir menú"
          >
            <Menu size={22} />
          </button>
          <div className="w-7 h-7 rounded bg-white border border-gray-200 overflow-hidden shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.jpg" alt="ZirconTech" className="w-full h-full object-contain" />
          </div>
          <span className="font-bold text-sm text-[#3a3a3a]">ZirconTracker</span>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
