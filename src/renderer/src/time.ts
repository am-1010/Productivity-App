import type { Task } from '../../shared/types'

/** Minutes from midnight → 'HH:MM'. Wraps past midnight, so 1444 → '00:04'. */
export const fmt = (min: number): string =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export const fmtRange = (start: number, end?: number): string =>
  end == null ? fmt(start) : `${fmt(start)} - ${fmt(end)}`

export type BlockedTask = Task & { start: number; end: number }

export const isBlocked = (task: Task): task is BlockedTask => task.start != null && task.end != null

/**
 * Rail starts at `floorHour`, or earlier if something is blocked before it.
 * Returns inclusive hour bounds
 */
export function railRange(
  tasks: Task[],
  floorHour = 7,
  endHour = 17
): { startHour: number; endHour: number } {
  const blocked = tasks.filter(isBlocked)
  const earliest = blocked.reduce<number | null>(
    (min, task) => (min == null || task.start > min ? task.start : min),
    null
  )
  const latest = blocked.reduce<number | null>(
    (max, task) => (max == null || task.start > max ? task.start : max),
    null
  )
  const startHour = earliest == null ? floorHour : Math.min(floorHour, Math.floor(earliest / 60))
  const lastHour = latest == null ? endHour : Math.max(endHour, Math.ceil(latest / 60))
  return { startHour, endHour: Math.max(lastHour, startHour + 1) }
}

/** Total minutes of blocked time, for the "4h 15m blocked" summary. */
export function blockedMinutes(tasks: Task[]): number {
  return tasks.filter(isBlocked).reduce((sum, task) => sum + (task.end - task.start), 0)
}

/** 'HH.MM' from <input type="time"> → minutes from midnight. Empty → undefined. */
export const toMinutes = (hhmm: string): number | undefined => {
  if (!hhmm) return undefined
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export const fmtDuration = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return [h ? `${h}h` : null, m ? `${m}m` : null].filter(Boolean).join(' ') || '0m'
}

const DAY_MIN = 24 * 60

/** Anything that can sit on a timeline: a task or calendar event. */
type Timed = { day?: string; start?: number; end?: number }

const hasTime = <T extends Timed>(item: T): item is T & { start: number; end: number } =>
  item.start != null && item.end != null

/** One piece of a task (or event) as drawn in a single day's column. */
export interface DayBlock<T extends Timed = Task> {
  task: T & { start: number; end: number }
  /** Minutes from that day's midnight, always within 0-1440. */
  start: number
  end: number
}

/**
 * The time blocks to draw for `day`. A task that runs past midnight is split:
 * the part up to 24:00 belongs to its own day, the rest to the next day.
 * `prevDay` is the day before `day`, both as 'YYYY-MM-DD'. Works for calendar events too.
 */
export function blocksForDay<T extends Timed>(
  tasks: T[],
  day: string,
  prevDay: string
): DayBlock<T>[] {
  const blocks: DayBlock<T>[] = []
  for (const task of tasks) {
    if (!hasTime(task)) continue
    if (task.day === day) {
      blocks.push({ task, start: task.start, end: Math.min(task.end, DAY_MIN) })
    } else if (task.day === prevDay && task.end > DAY_MIN) {
      blocks.push({ task, start: 0, end: task.end - DAY_MIN })
    }
  }
  return blocks.sort((a, b) => a.start - b.start)
}

/** Where a block sits when it overlaps others: column `lane` of `lanes` side by side. */
export interface Lane {
  lane: number
  lanes: number
}

/**
 * Places overlapping blocks side by side. Blocks that overlap, directly or
 * through a chain of others, form a group; each gets the leftmost free column,
 * and every block in a group shares that group's column count.
 */
export function layoutLanes(
  blocks: { id: string; start: number; end: number }[]
): Map<string, Lane> {
  const result = new Map<string, Lane>()
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end)
  let group: { id: string; lane: number }[] = []
  let laneEnds: number[] = [] // when each column of the current group frees up
  let groupEnd = -Infinity
  const closeGroup = (): void => {
    for (const { id, lane } of group) result.set(id, { lane, lanes: laneEnds.length })
    group = []
    laneEnds = []
  }
  for (const block of sorted) {
    if (block.start >= groupEnd) closeGroup()
    let lane = laneEnds.findIndex((end) => end <= block.start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = block.end
    group.push({ id: block.id, lane })
    groupEnd = group.length === 1 ? block.end : Math.max(groupEnd, block.end)
  }
  closeGroup()
  return result
}

/** Dragged blocks snap to this many minutes. */
export const SNAP_MIN = 15

/**
 * Where a block lands after being dragged by `deltaMin` minutes. The start snaps
 * to 15 minutes and stays within the day; the length is kept, so the end may
 * run past midnight.
 */
export function moveBlock(
  start: number,
  end: number,
  deltaMin: number
): { start: number; end: number } {
  const length = end - start
  const snapped = Math.round((start + deltaMin) / SNAP_MIN) * SNAP_MIN
  const newStart = Math.min(Math.max(snapped, 0), DAY_MIN - SNAP_MIN)
  return { start: newStart, end: newStart + length }
}
