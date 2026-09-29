// Loads the "Facturas por cliente" template from the DB (InvoiceBlock +
// InvoiceLineDef), resolved into the exact InvoiceBlockDef[] shape
// computeInvoice()/getBlockTotals() already consume — so the calculation
// engine in lib/invoice-sheet.ts doesn't need to know the template used to
// be a hardcoded constant.

import { prisma } from '@/lib/prisma'
import type { InvoiceBlockDef, InvoiceItemDef, InvoiceUnit } from '@/lib/invoice-sheet'

export async function getInvoiceTemplate(opts: { activeOnly: boolean }): Promise<InvoiceBlockDef[]> {
  const blocks = await prisma.invoiceBlock.findMany({
    where: opts.activeOnly ? { active: true } : undefined,
    orderBy: { order: 'asc' },
    include: {
      project: { select: { name: true } },
      items: { orderBy: { order: 'asc' }, include: { resource: { select: { name: true } } } },
    },
  })

  return blocks.map((block): InvoiceBlockDef => ({
    id: block.slug,
    client: block.client,
    header: block.header,
    okMark: block.okMark,
    priceLabel: block.priceLabel,
    qtyLabel: block.qtyLabel,
    unit: block.unit as InvoiceUnit,
    projectLookup: block.project ? [block.project.name] : null,
    items: block.items.map((item): InvoiceItemDef => {
      switch (item.type) {
        case 'text':
          return { type: 'text', text: item.label }
        case 'blank':
          return { type: 'blank' }
        case 'sum':
          return {
            type: 'sum', id: item.refSlug, label: item.label,
            over: item.refs ? item.refs.split(',') : [],
            qty: item.qtyIsSum || undefined, avgRate: item.avgRate || undefined,
            comment: item.comment || undefined,
          }
        case 'vat':
          return {
            type: 'vat', id: item.refSlug, label: item.label, of: item.refs,
            factor: item.factor ?? 1, comment: item.comment || undefined,
          }
        case 'discount':
          return {
            type: 'discount', id: item.refSlug, label: item.label, from: item.refs,
            rate: item.factor ?? 0, comment: item.comment || undefined,
          }
        case 'line':
        default:
          return {
            type: 'line', id: item.refSlug, label: item.label,
            rate: item.rate ?? null, rateFormula: item.rateFormula ?? undefined,
            person: item.hasPerson ? (item.resource?.name.trim() ?? null) : undefined,
            qtyDefault: item.qtyDefault || undefined, comment: item.comment || undefined,
          }
      }
    }),
  }))
}

// All blocks (active + inactive) keyed by slug -> display client name, for
// resolving historical ClientInvoice rows whose block may now be hidden.
export async function getBlockClientNames(): Promise<Record<string, string>> {
  const blocks = await prisma.invoiceBlock.findMany({ select: { slug: true, client: true } })
  return Object.fromEntries(blocks.map((b) => [b.slug, b.client]))
}
