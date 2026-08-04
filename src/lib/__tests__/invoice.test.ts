import { describe, it, expect } from 'vitest'
import { computeTotals, lineAmount, normalizeItems, suggestInvoiceNumber } from '@/lib/invoice'

/**
 * Money arithmetic. The reason this is done in cents is that summing floats
 * drifts, and an invoice whose line items do not add up to its printed total is
 * the kind of bug that costs trust rather than money.
 */
describe('lineAmount', () => {
  it('multiplies and rounds once', () => {
    expect(lineAmount(3, 42.5)).toBe(127.5)
    expect(lineAmount(120, 42)).toBe(5040)
  })

  it('handles the classic float case', () => {
    // 0.1 + 0.2 = 0.30000000000000004 territory.
    expect(lineAmount(3, 0.1)).toBe(0.3)
    expect(lineAmount(1, 0.615)).toBeCloseTo(0.62, 2)
  })

  it('treats non-finite input as zero rather than NaN', () => {
    expect(lineAmount(Number.NaN, 10)).toBe(0)
  })
})

describe('computeTotals', () => {
  it('sums line items exactly', () => {
    const totals = computeTotals([
      { quantity: 3, rate: 0.1 },
      { quantity: 3, rate: 0.1 },
      { quantity: 3, rate: 0.1 },
    ])
    // Naive float addition gives 0.8999999999999999.
    expect(totals.subtotal).toBe(0.9)
    expect(totals.total).toBe(0.9)
  })

  it('applies tax on the subtotal', () => {
    const totals = computeTotals([{ quantity: 1, rate: 100 }], 18)
    expect(totals.subtotal).toBe(100)
    expect(totals.tax).toBe(18)
    expect(totals.total).toBe(118)
  })

  it('computes the balance due after a partial payment', () => {
    const totals = computeTotals([{ quantity: 1, rate: 500 }], 0, 200)
    expect(totals.total).toBe(500)
    expect(totals.balanceDue).toBe(300)
  })

  it('never reports a negative balance on an overpayment', () => {
    const totals = computeTotals([{ quantity: 1, rate: 100 }], 0, 250)
    expect(totals.balanceDue).toBe(0)
  })

  it('handles an empty invoice', () => {
    const totals = computeTotals([], 10, 0)
    expect(totals).toEqual({ subtotal: 0, tax: 0, total: 0, balanceDue: 0 })
  })
})

describe('normalizeItems', () => {
  it('stamps each line with its computed amount', () => {
    const items = normalizeItems([{ description: 'Staffing', quantity: 120, rate: 42 }])
    expect(items[0].amount).toBe(5040)
    expect(items[0].description).toBe('Staffing')
  })
})

describe('suggestInvoiceNumber', () => {
  it('starts at INV-0001 for a new workspace', () => {
    expect(suggestInvoiceNumber([])).toBe('INV-0001')
  })

  it('continues from the highest existing number', () => {
    expect(suggestInvoiceNumber(['INV-0001', 'INV-0007', 'INV-0003'])).toBe('INV-0008')
  })

  it('reads the trailing digits of an arbitrary prefix', () => {
    expect(suggestInvoiceNumber(['ACME/2026/0042'])).toBe('INV-0043')
  })

  it('ignores entries with no number', () => {
    expect(suggestInvoiceNumber(['DRAFT', 'INV-0002'])).toBe('INV-0003')
  })
})
