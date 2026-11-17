import { describe, expect, it } from 'vitest'
import type { Task } from '../../shared/types'
import {
  blocksForDay,
  blockedMinutes,
  fmt,
  fmtDuration,
  fmtRange,
  moveBlock,
  railRange,
  toMinutes
} from './time'

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

describe('blocksForDay', () => {
  const on = (day: string, start?: number, end?: number): Task => ({ ...task(start, end), day })

  it("returns that day's timed tasks, earliest first", () => {
    const blocks = blocksForDay(
      [on('2026-11-10', 840, 900), on('2026-11-10', 540, 600), on('2026-11-11', 600, 660)],
      '2026-11-10',
      '2026-11-09'
    )
    expect(blocks.map((b) => [b.start, b.end])).toEqual([
      [540, 600],
      [840, 900]
    ])
  })

  it('leaves, out tasks with no time', () => {
    expect(blocksForDay([on('2026-11-10')], '2026-11-10', '2026-11-09')).toEqual([])
  })

  it('splits a task that runs past midnight across two days', () => {
    const late = on('2026-11-10', 1380, 1470) // 23:00 - 00:30

    expect(blocksForDay([late], '2026-11-10', '2026-11-09')).toEqual([
      { task: late, start: 1380, end: 1440 }
    ])
    expect(blocksForDay([late], '2026-11-11', '2026-11-10')).toEqual([
      { task: late, start: 0, end: 30 }
    ])
  })
})

describe('moveBlock', () => {
  it('moves the block and keeps its length', () => {
    expect(moveBlock(540, 600, 60)).toEqual({ start: 600, end: 660 })
    expect(moveBlock(540, 600, -90)).toEqual({ start: 450, end: 510 })
  })

  it('snaps the start to the nearest 15 minutes', () => {
    expect(moveBlock(540, 600, 7)).toEqual({ start: 540, end: 600 })
    expect(moveBlock(540, 600, 8)).toEqual({ start: 555, end: 615 })
    expect(moveBlock(544, 604, 0)).toEqual({ start: 540, end: 600 }) // 09:04 → 09:00
  })

  it('does not go above 00:00', () => {
    expect(moveBlock(30, 90, -120)).toEqual({ start: 0, end: 60 })
  })

  it('does not start later than 23:45, but may end past midnight', () => {
    expect(moveBlock(1320, 1380, 500)).toEqual({ start: 1425, end: 1485 })
  })
})
