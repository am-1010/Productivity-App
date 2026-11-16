import { describe, expect, it } from 'vitest'
import { addDays, dayHeading, localDay, startOfWeek } from './day'

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

describe('addDays', () => {
  it('moves forward and back across month and year ends', () => {
    expect(localDay(addDays(new Date(2026, 10, 30), 1))).toBe('2026-12-01')
    expect(localDay(addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31')
  })
})

describe('startOfWeek', () => {
  it('returns the Monday of that week', () => {
    expect(localDay(startOfWeek(new Date(2026, 10, 12, 15, 0)))).toBe('2026-11-09') // a Thursday
  })

  it('treats Sunday as the last day of the week, not the first', () => {
    expect(localDay(startOfWeek(new Date(2026, 10, 15)))).toBe('2026-11-09')
  })

  it('returns the same day for a Monday', () => {
    expect(localDay(startOfWeek(new Date(2026, 10, 16)))).toBe('2026-11-16')
  })
})
