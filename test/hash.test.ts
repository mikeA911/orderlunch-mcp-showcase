import { describe, expect, it } from 'vitest'
import { canonicalHash } from '../src/domain/hash.js'

describe('canonicalHash', () => {
  it('is stable for the same immutable quotation payload', () => {
    const quote = { outletId: 'canteen-sim', items: [{ id: 'canteen-adobo', quantity: 2 }], totalMinor: 33000 }
    expect(canonicalHash(quote)).toBe(canonicalHash(quote))
  })
  it('changes when the quoted total changes', () => {
    expect(canonicalHash({ totalMinor: 33000 })).not.toBe(canonicalHash({ totalMinor: 34000 }))
  })
})
