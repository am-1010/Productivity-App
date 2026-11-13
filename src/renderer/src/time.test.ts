import { describe, expect, it } from 'vitest'
import type { Task } from '../../shared/types'
import { blockedMinutes, fmt, fmtDuration, fmtRange, railRange, toMinutes } from './time'

/** A task with just the fields these helpers care about. */
const task = (start?: number, end?: number): Task => ({
  id: 'x',
  title: 'x',
  done: false,
  start,
  end
})

describe('fmt', () => {
  it('pads hours and minutes', () => {
    expect(fmt(0)).toBe('00:00')
    expect(fmt(545)).toBe('09:05')
  })

  it('wraps past midnight', () => {
    expect(fmt(1444)).toBe('00:04') // 24:04 → 00:04
  })
})

describe('fmtRange', () => {
  it('shows a single time when there is no end', () => {
    expect(fmtRange(540)).toBe('09:00')
  })

  it('joins start and end', () => {
    expect(fmtRange(540, 600)).toBe('09:00 - 10:00')
  })
})

describe('toMinutes', () => {
  it('returns undefined for an empty input', () => {
    expect(toMinutes('')).toBeUndefined()
  })

  it('converts HH:MM to minutes from midnight', () => {
    expect(toMinutes('09:30')).toBe(570)
    expect(toMinutes('23:59')).toBe(1439)
  })
})

describe('fmtDuration', () => {
  it('formats hours and minutes', () => {
    expect(fmtDuration(0)).toBe('0m')
    expect(fmtDuration(45)).toBe('45m')
    expect(fmtDuration(60)).toBe('1h')
    expect(fmtDuration(255)).toBe('4h 15m')
  })
})

describe('blockedMinutes', () => {
  it('adds up only tasks that have both a start and an end', () => {
    expect(blockedMinutes([task(540, 600), task(600, 615), task(), task(700)])).toBe(75)
  })
})

describe('railRange', () => {
  it('defaults to 7-17 with nothing blocked', () => {
    expect(railRange([])).toEqual({ startHour: 7, endHour: 17 })
  })

  it('starts earlier for an early task', () => {
    expect(railRange([task(390, 420)])).toEqual({ startHour: 6, endHour: 17 }) // 06:30
  })

  it('ends later for an evening task', () => {
    expect(railRange([task(1260, 1320)]).endHour).toBe(21)
    expect(railRange([task(1290, 1320)]).endHour).toBe(22)
  })

  it('ignores tasks without both times', () => {
    expect(railRange([task(300)])).toEqual({ startHour: 7, endHour: 17 })
  })
})
