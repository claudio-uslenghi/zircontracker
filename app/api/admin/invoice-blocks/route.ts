export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'cliente'
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base
  let n = 1
  while (await prisma.invoiceBlock.findUnique({ where: { slug } })) {
    n += 1
    slug = `${base}-${n}`
  }
  return slug
}

// Lists every InvoiceBlock (active + hidden) with its lines, for the
// "Configurar clientes" admin screen. Full CRUD lives here + [id]/route.ts +
// [id]/items/route.ts — the monthly generation flow only ever reads active
// blocks via lib/invoice-template.ts.
export async function GET() {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const blocks = await prisma.invoiceBlock.findMany({
    orderBy: { order: 'asc' },
    include: {
      project: { select: { id: true, name: true } },
      items: { orderBy: { order: 'asc' }, include: { resource: { select: { id: true, name: true } } } },
    },
  })
  return NextResponse.json({ blocks })
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const client = String(body.client ?? '').trim()
  if (!client) return NextResponse.json({ error: 'Falta el nombre del cliente' }, { status: 400 })

  const slug = await uniqueSlug(slugify(client))
  const maxOrder = await prisma.invoiceBlock.aggregate({ _max: { order: true } })

  const block = await prisma.invoiceBlock.create({
    data: {
      slug,
      client,
      customerName: String(body.customerName ?? client).trim() || client,
      order: (maxOrder._max.order ?? -1) + 1,
      header: body.header !== undefined ? Boolean(body.header) : true,
      okMark: Boolean(body.okMark),
      priceLabel: String(body.priceLabel ?? 'Precio'),
      qtyLabel: String(body.qtyLabel ?? 'Horas'),
      unit: body.unit === 'days' ? 'days' : 'hours',
      projectId: body.projectId != null ? Number(body.projectId) : null,
      paymentTermDays: body.paymentTermDays != null ? Number(body.paymentTermDays) : 30,
    },
  })
  return NextResponse.json(block, { status: 201 })
}
