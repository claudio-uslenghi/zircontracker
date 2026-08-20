import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-options'
import { prisma } from '@/lib/prisma'

export async function getSession() {
  return getServerSession(authOptions)
}

export function getUserRoles(session: Awaited<ReturnType<typeof getSession>>): string[] {
  return (session?.user as { roles?: string[] })?.roles ?? []
}

export async function requireAdmin() {
  const session = await getSession()
  const roles = getUserRoles(session)
  if (!roles.includes('admin')) {
    throw new Error('Forbidden')
  }
  return session!
}

// Allows the request through if the session belongs to an admin, or to the
// Resource matched by the session user's email — never trusts a resourceId
// supplied by the client for a non-admin caller.
export async function requireSelfOrAdmin(resourceId: number) {
  const session = await getSession()
  if (!session) throw new Error('Forbidden')

  const roles = getUserRoles(session)
  if (roles.includes('admin')) return session

  const email = session.user?.email
  if (!email) throw new Error('Forbidden')

  const resource = await prisma.resource.findUnique({ where: { email } })
  if (!resource || resource.id !== resourceId) {
    throw new Error('Forbidden')
  }
  return session
}

// Allows the request through if the session belongs to an admin, or to any
// user with a Resource linked by email — for self-service writes that
// aren't scoped to one specific resource's own data (e.g. creating a Task,
// which any colaborador may add regardless of which resource ends up using it).
export async function requireAdminOrOwnResource() {
  const session = await getSession()
  if (!session) throw new Error('Forbidden')

  const roles = getUserRoles(session)
  if (roles.includes('admin')) return session

  const email = session.user?.email
  if (!email) throw new Error('Forbidden')

  const resource = await prisma.resource.findUnique({ where: { email } })
  if (!resource) throw new Error('Forbidden')
  return session
}

// Resolves the Resource linked to the current session's email.
// Throws 'Forbidden' if unauthenticated, 'NoResource' if no Resource matches.
export async function requireOwnResource() {
  const session = await getSession()
  if (!session) throw new Error('Forbidden')

  const email = session.user?.email
  if (!email) throw new Error('Forbidden')

  const resource = await prisma.resource.findUnique({ where: { email } })
  if (!resource) throw new Error('NoResource')
  return resource
}

export async function checkPagePermission(page: string): Promise<boolean> {
  const session = await getSession()
  if (!session) return false

  const roles = getUserRoles(session)

  // Admin always has access to everything
  if (roles.includes('admin')) return true

  if (roles.length === 0) return false

  const count = await prisma.pagePermission.count({
    where: {
      page,
      role: { name: { in: roles } },
    },
  })

  return count > 0
}
