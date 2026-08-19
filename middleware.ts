import { getToken } from 'next-auth/jwt'
import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth', '/unauthorized']

// Accessible to any authenticated user regardless of their PagePermission
// matrix — e.g. changing your own password isn't a "page" you're granted.
const ALWAYS_ALLOWED_AUTHENTICATED = ['/perfil']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public paths and static assets — logo/favicon must be reachable
  // from the unauthenticated login page too.
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    /\.(jpg|jpeg|png|svg|gif|webp|ico)$/i.test(pathname)
  ) {
    return NextResponse.next()
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  if (!token) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // API routes: just verify token exists (role checks done in each handler)
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const roles = (token.roles as string[]) ?? []
  const isAdmin = roles.includes('admin')

  // Admin pages: require admin role in JWT
  if (pathname.startsWith('/admin')) {
    if (!isAdmin) {
      return NextResponse.redirect(new URL('/unauthorized', req.url))
    }
    return NextResponse.next()
  }

  // Everyone gets a fixed set of self-service pages regardless of PagePermission.
  if (ALWAYS_ALLOWED_AUTHENTICATED.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Non-admin pages: gated by the PagePermission matrix, snapshotted into the
  // JWT at sign-in (see lib/auth-options.ts). Admin bypasses this check.
  if (!isAdmin) {
    const allowedPages = (token.allowedPages as string[]) ?? []
    const allowed = allowedPages.some((p) => pathname.startsWith(p))
    if (!allowed) {
      return NextResponse.redirect(new URL('/unauthorized', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
