import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-options'
import { prisma } from '@/lib/prisma'
import { createClient } from '@libsql/client'
import type { ImportTimeEntriesResult, ParsedTimeEntry } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const roles = (session?.user as { roles?: string[] })?.roles ?? []
  if (!roles.includes('admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const entries: ParsedTimeEntry[] = body.entries ?? []

  if (!entries.length) {
    return NextResponse.json({ error: 'No entries provided' }, { status: 400 })
  }

  // Build lookup maps (case-insensitive)
  const resources = await prisma.resource.findMany({ select: { id: true, name: true } })
  const projects = await prisma.project.findMany({ select: { id: true, name: true } })

  const resourceMap = new Map<string, number>(
    resources.map((r) => [r.name.toLowerCase().trim(), r.id])
  )
  const projectMap = new Map<string, number>(
    projects.map((p) => [p.name.toLowerCase().trim(), p.id])
  )

  const unmatchedResources = new Set<string>()
  const unmatchedProjects = new Set<string>()

  type ResolvedEntry = { resourceId: number; projectId: number; date: string; hours: number; entryType: string }
  const resolved: ResolvedEntry[] = []

  for (const e of entries) {
    let resourceId = resourceMap.get(e.resourceName.toLowerCase().trim())

    // Fallback: match by email using "first-initial + last-name" convention
    // e.g. "cuslenghi@zircon.tech" → prefix "cuslenghi" → matches "Claudio Uslenghi"
    if (!resourceId && e.resourceEmail) {
      const prefix = e.resourceEmail.split('@')[0].toLowerCase()
      const found = resources.find((r) => {
        const parts = r.name.toLowerCase().split(/\s+/)
        if (parts.length >= 2) {
          const initLast = parts[0][0] + parts[parts.length - 1]
          return initLast === prefix
        }
        return r.name.toLowerCase().replace(/\s+/g, '') === prefix
      })
      if (found) resourceId = found.id
    }

    const projectId = projectMap.get(e.projectName.toLowerCase().trim())

    if (!resourceId) {
      unmatchedResources.add(e.resourceEmail ? `${e.resourceName} (${e.resourceEmail})` : e.resourceName)
      continue
    }
    if (!projectId) {
      unmatchedProjects.add(e.projectName)
      continue
    }

    resolved.push({ resourceId, projectId, date: e.date, hours: e.hours, entryType: e.entryType ?? 'regular' })
  }

  if (!resolved.length) {
    return NextResponse.json({
      inserted: 0,
      updated: 0,
      skipped: entries.length,
      unmatchedResources: Array.from(unmatchedResources),
      unmatchedProjects: Array.from(unmatchedProjects),
      errors: [],
    } satisfies ImportTimeEntriesResult)
  }

  // Count existing records before batch (simple, no complex OR)
  const countBefore = await prisma.timeEntry.count()

  // Use libSQL batch for performance (single HTTP round-trip to Turso)
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  // Process in chunks of 1000 to avoid request size limits
  const CHUNK = 1000
  for (let i = 0; i < resolved.length; i += CHUNK) {
    const chunk = resolved.slice(i, i + CHUNK)
    await turso.batch(
      chunk.map((e) => ({
        sql: `INSERT INTO "TimeEntry" (resourceId, projectId, date, hours, entryType)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (resourceId, projectId, date, entryType) DO UPDATE SET hours = excluded.hours`,
        args: [e.resourceId, e.projectId, e.date, e.hours, e.entryType],
      })),
      'write'
    )
  }
  turso.close()

  // Count after to determine inserts vs updates
  const countAfter = await prisma.timeEntry.count()
  const inserted = countAfter - countBefore
  const updated = resolved.length - inserted

  return NextResponse.json({
    inserted,
    updated,
    skipped: entries.length - resolved.length,
    unmatchedResources: Array.from(unmatchedResources),
    unmatchedProjects: Array.from(unmatchedProjects),
    errors: [],
  } satisfies ImportTimeEntriesResult)
}
