import { describe, expect, it } from 'vitest'
import { dayHeading, localDay } from './day'

describe('localDay', () => {
  it('formats a date as YYYY-MM-DD with padding', () => {
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('uses the local day, not UTC, late in the evening', () => {
    expect(localDay(new Date(2026, 10, 12, 23, 30))).toBe('2026-11-12')
  })
})

describe('dayHeading', () => {
  const today = new Date(2026, 10, 12, 15, 0) //12 Nov 2026, 3pm

  it('says Tomorrow for the next day', () => {
    expect(dayHeading('2026-11-13', today)).toBe('Tomorrow')
  })

  it('handles tomorrow across a month boundary', () => {
    expect(dayHeading('2026-12-01', new Date(2026, 10, 30))).toBe('Tomorrow')
  })

  it('leaves out the year for dates this year', () => {
    expect(dayHeading('2026-11-20', today)).not.toContain('2026')
  })

  it('includes the year for dates in another year', () => {
    expect(dayHeading('2027-01-04', today)).toContain('2027')
  })
})
