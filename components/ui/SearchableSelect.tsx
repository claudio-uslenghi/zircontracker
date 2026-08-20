'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface SearchableSelectOption {
  value: string
  label: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  className?: string
}

interface Position {
  top: number
  left: number
  width: number
}

// Drop-in replacement for a native <select> that adds type-to-filter, while
// keeping the same value/onChange(string) contract every call site already
// uses. Native <select> has no way to filter by typing, so this has to be a
// text input + dropdown list rather than an actual <select>.
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Seleccionar...',
  className = 'border border-gray-300 rounded px-2 py-1.5 text-sm',
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [position, setPosition] = useState<Position | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  // The dropdown renders through a portal (see below) instead of as a normal
  // absolutely-positioned child, so it can never be clipped by an ancestor's
  // `overflow: hidden/auto/scroll` (e.g. a scrollable table wrapper) — it's
  // positioned in fixed viewport coordinates read off the input itself, and
  // recalculated on scroll/resize while open.
  function updatePosition() {
    const el = inputRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPosition({ top: rect.bottom, left: rect.left, width: Math.max(rect.width, 180) })
  }

  useLayoutEffect(() => {
    if (open) updatePosition()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = () => updatePosition()
    // capture:true so this also fires for scroll on nested containers
    // (e.g. the horizontally-scrollable table wrapper in Mis Horas), whose
    // scroll events don't bubble to window in the normal bubbling phase.
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [open])

  function openList() {
    setOpen(true)
    setQuery('')
    setHighlightIndex(0)
  }

  function closeList() {
    setOpen(false)
    setQuery('')
  }

  function selectOption(opt: SearchableSelectOption) {
    onChange(opt.value)
    closeList()
    inputRef.current?.blur()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault()
        openList()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[highlightIndex]
      if (opt) selectOption(opt)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeList()
    }
  }

  const displayValue = open ? query : (selectedOption?.label ?? '')

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        placeholder={selectedOption ? undefined : placeholder}
        onFocus={openList}
        onBlur={closeList}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlightIndex(0) }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        className={className}
      />
      {open && position && createPortal(
        <div
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            width: position.width,
            zIndex: 9999,
          }}
          className="mt-1 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">Sin resultados</div>
          ) : (
            filtered.map((opt, i) => (
              <button
                key={opt.value || '__empty__'}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectOption(opt)}
                className={`w-full text-left px-3 py-1.5 text-sm ${
                  i === highlightIndex ? 'bg-blue-50 text-[#0170B9]' : 'hover:bg-gray-50'
                } ${opt.value === value ? 'font-semibold' : ''}`}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
