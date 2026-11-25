/**
 * TodayView — draft 1a ("calm two-pane") from the mockups.
 *
 * Stack notes (Electron + React + TS + SQLite):
 *  - This component is pure presentation. It takes rows already loaded over IPC
 *    from the main process, so the renderer never touches the DB directly.
 *  - Times are stored as minutes-from-midnight integers (`start`, `end`), which
 *    is the easiest shape to sort and range-query in SQLite and avoids all
 *    timezone ambiguity for a local-first day planner.
 *
 *      -- suggested schema
 *      CREATE TABLE task (
 *        id          TEXT PRIMARY KEY,
 *        title       TEXT NOT NULL,
 *        project     TEXT,
 *        source      TEXT,              -- 'gmail' | 'slack' | 'linear' | null
 *        day         TEXT,              -- 'YYYY-MM-DD', null = unscheduled
 *        start_min   INTEGER,           -- null = not blocked on the calendar
 *        end_min     INTEGER,
 *        done_at     INTEGER            -- unix seconds, null = open
 *      );
 *      CREATE INDEX task_day_start ON task(day, start_min);
 *
 *      -- day query
 *      SELECT * FROM task
 *      WHERE (day = ?1 AND done_at IS NULL) OR (day IS NULL AND done_at IS NULL)
 *      ORDER BY start_min IS NULL, start_min;
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CalendarEvent, Connection, NewTaskInput, Task } from '../../shared/types'
import { ConnectionsView } from './ConnectionsView'
import { addDays, dayHeading, localDay } from './day'
import { AllDayChip, EventBlock } from './EventBlock'
import { dropHighlight, eyebrow, laneBox, t } from './theme'
import { WeekNav, WeekView } from './WeekView'
import {
  blockedMinutes,
  blocksForDay,
  layoutLanes,
  type DayBlock,
  type Lane,
  fmt,
  fmtRange,
  isBlocked,
  moveBlock,
  railRange,
  toMinutes,
  fmtDuration
} from './time'
import { useBlockDrag, type BlockDrag } from './useBlockDrag'

/* ------------------------------------------------------------------- types */

export interface TodayViewProps {
  date: Date
  tasks: Task[]
  upcoming?: Task[]
  overdue?: Task[]
  /** Tasks for the week view: the shown week plus the day before it. */
  week?: Task[]
  /** Calendar events for today and yesterday (a late one can run into today). */
  events?: CalendarEvent[]
  /** Calendar events for the week view, over the same days as `week`. */
  weekEvents?: CalendarEvent[]
  /** Connected calendars, for the Connections page. */
  connections?: Connection[]
  onRemoveConnection?: (id: string) => void
  onConnectGoogle?: () => Promise<void>
  onReconnectConnection?: (id: string) => Promise<void>
  onCancelSignIn?: () => void
  onSyncConnections?: () => Promise<void>
  /** Adds made-up events to try things out. Only passed while developing. */
  onAddSampleCalendar?: () => void
  /** Finished tasks for the Done tab, most recently finished first. */
  done?: Task[]
  /** Looks up tasks for the Search page. */
  onSearch?: (query: string) => Promise<Task[]>
  /** Monday of the week the week view is showing. */
  weekStart?: Date
  onChangeWeek?: (start: Date) => void
  /** Counts for the tab strip; supplied by the caller so this view stays dumb. */
  counts?: { today: number; overdue?: number; inbox: number; upcoming?: number }
  activeNav?: NavKey
  /** Minutes from midnight. Pass a ticking value to animate the now-line. */
  nowMinutes: number
  onToggleTask?: (id: string) => void
  onNewTask?: (input: NewTaskInput) => Promise<void>
  onUpdateTask?: (id: string, input: NewTaskInput) => Promise<void>
  onDeleteTask?: (id: string) => void
  onNavigate?: (key: NavKey) => void
  /** Earliest hour the rail will ever show when the day starts late. */
  railFloorHour?: number
  /** Last hour label on the rail. */
  railEndHour?: number
}

export type NavKey = 'today' | 'week' | 'search' | 'account'

/* --------------------------------------------------------------- utilities */

const HOUR_PX = 54
/** Length given to a task with no time when it is dragged onto the timeline. */
const NEW_BLOCK_MIN = 30

/** Where a task dragged on the Today page will land. */
type TodayDrop = { kind: 'rail'; start: number; end: number } | { kind: 'unscheduled' }

/* ---------------------------------------------------------------- subviews */

const NAV: { key: NavKey; label: string; tip: string; icon: ReactNode }[] = [
  {
    key: 'today',
    label: 'Today',
    tip: "Today — everything you've committed to today, beside your day's timeline",
    icon: (
      <>
        <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
        <path d="M3 8.5h14M7 3v3M13 3v3" />
        <circle cx="10" cy="12.5" r="1.3" fill="currentColor" stroke="none" />
      </>
    )
  },
  {
    key: 'week',
    label: 'Week',
    tip: 'Week — the whole week as a timeline, for moving blocks around',
    icon: (
      <>
        <rect x="3" y="4" width="14" height="13" rx="2.5" />
        <path d="M7.7 4v13M12.3 4v13" />
      </>
    )
  },
  {
    key: 'search',
    label: 'Search',
    tip: 'Search — find any task by its title or notes',
    icon: (
      <>
        <circle cx="9" cy="9" r="5.2" />
        <path d="M13 13l4 4" />
      </>
    )
  }
]

const Logo: React.FC = () => (
  <div
    style={{
      width: 28,
      height: 28,
      borderRadius: 9,
      background: t.textMax,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 'none'
    }}
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-label="App logo">
      <rect x="1.5" y="2" width="8" height="3.2" rx="1.1" fill={t.shell} />
      <rect x="4.5" y="6.4" width="10" height="3.2" rx="1.1" fill={t.shell} />
      <rect x="1.5" y="10.8" width="6" height="3.2" rx="1.1" fill={t.shell} />
    </svg>
  </div>
)

const IconRail: React.FC<{ active: NavKey; onNavigate?: (k: NavKey) => void }> = ({
  active,
  onNavigate
}) => (
  <nav
    style={{
      width: 60,
      flex: 'none',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '18px 0',
      gap: 14
    }}
  >
    <Logo />
    <div style={{ height: 8 }} />
    {NAV.map(({ key, label, tip, icon }) => {
      const on = key === active
      return (
        <button
          key={key}
          title={tip}
          aria-label={label}
          aria-current={on || undefined}
          onClick={() => onNavigate?.(key)}
          style={{
            width: 30,
            height: 30,
            border: 'none',
            padding: 0,
            borderRadius: 8,
            background: on ? t.control : 'transparent',
            color: on ? t.textMax : t.text5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {icon}
          </svg>
        </button>
      )
    })}
    <button
      title="Connections - link Google Calendar, Apple Calendar and Canvas"
      aria-label="Account"
      onClick={() => onNavigate?.('account')}
      style={{
        marginTop: 'auto',
        width: 26,
        height: 26,
        border: 'none',
        padding: 0,
        borderRadius: '50%',
        background: '#222222',
        boxShadow:
          active === 'account' ? `0 0 0 2px ${t.shell}, 0 0 0 3px ${t.textMax}` : undefined,
        cursor: 'pointer'
      }}
    />
  </nav>
)

const Check: React.FC<{ on?: boolean; done?: boolean; onClick?: () => void }> = ({
  on,
  done,
  onClick
}) => (
  <button
    onClick={(e) => {
      e.stopPropagation()
      onClick?.()
    }}
    aria-label={done ? 'Mark incomplete' : 'Mark complete'}
    style={{
      width: 17,
      height: 17,
      flex: 'none',
      padding: 0,
      borderRadius: '50%',
      background: done ? t.strokeControl : 'transparent',
      border: `1.5px solid ${on ? t.markerActive : t.strokeControl}`,
      cursor: 'pointer'
    }}
  />
)

/**
 * Quiet empty state. No illustration, no call-to-action button — a single line
 * at metadata weight, so an empty day reads as calm rather than broken.
 */
const EmptyNote: React.FC<{ children: ReactNode; hint?: string }> = ({ children, hint }) => (
  <div style={{ padding: '13px 14px 15px' }}>
    <div style={{ fontSize: 14.5, color: t.text4 }}>{children}</div>
    {hint && <div style={{ marginTop: 6, font: `400 11px ${t.mono}`, color: t.text6 }}>{hint}</div>}
  </div>
)

/** Whole-day empty state: nothing scheduled, nothing waiting. */
const DayEmpty: React.FC<{ inboxCount?: number; onNewTask?: () => void }> = ({
  inboxCount,
  onNewTask
}) => (
  <div
    style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
      gap: 10,
      paddingBottom: 60
    }}
  >
    <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-.015em', color: t.text2 }}>
      Nothing on today.
    </div>
    <div style={{ fontSize: 14.5, color: t.text4, maxWidth: 420, lineHeight: 1.55 }}>
      {inboxCount
        ? `Your day is clear. ${inboxCount} ${inboxCount === 1 ? 'item' : 'items'} in the inbox if you want to pull something forward.`
        : 'Your day is clear and the inbox is empty.'}
    </div>
    <div
      onClick={onNewTask}
      style={{
        marginTop: 4,
        font: `400 11px ${t.mono}`,
        color: t.text6,
        letterSpacing: '.12em',
        textTransform: 'uppercase',
        cursor: 'pointer'
      }}
    >
      Add a task
    </div>
  </div>
)

const TaskRow: React.FC<{
  task: Task
  now?: boolean
  onToggle?: () => void
  onOpen?: () => void
  onDelete?: () => void
  /** Faded while it is being dragged. */
  dragging?: boolean
  /** Makes the row draggable. A click without moving still opens it. */
  onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void
  /** Shows the tasks's day before its time, such as "Yesterday". */
  dayLabel?: string
}> = ({ task, now, onToggle, onOpen, onDelete, dragging, onPointerDown, dayLabel }) => {
  const time = isBlocked(task)
    ? fmtRange(task.start, task.end)
    : task.start != null
      ? fmt(task.start)
      : null
  const meta = [
    [dayLabel, time].filter(Boolean).join(', ') || null,
    task.project ?? (task.source ? `from ${task.source}` : null)
  ].filter(Boolean) as string[]

  return (
    <div
      data-task
      onClick={onPointerDown ? undefined : onOpen}
      onPointerDown={(e) => {
        // The tick and × buttons inside the row do their own thing.
        if (!(e.target as HTMLElement).closest('button')) onPointerDown?.(e)
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: now ? '14px' : '13px 14px',
        borderRadius: 10,
        cursor: onPointerDown ? 'grab' : 'pointer',
        userSelect: 'none',
        opacity: dragging ? 0.3 : 1,
        background: now ? t.surface2 : 'transparent'
      }}
    >
      <Check on={now} done={task.done} onClick={onToggle} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            color: task.done ? t.text5 : now ? t.text1 : t.text2,
            textDecoration: task.done ? 'line-through' : undefined
          }}
        >
          {task.title}
        </div>
        {task.notes && (
          <div
            style={{
              marginTop: 4,
              fontSize: 13,
              color: t.text4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {task.notes}
          </div>
        )}
        {meta.length > 0 && (
          <div
            style={{
              marginTop: 5,
              display: 'flex',
              gap: 10,
              font: `400 11px ${t.mono}`,
              color: t.text4
            }}
          >
            <span style={now ? { color: t.textMax } : undefined}>{meta[0]}</span>
            {meta[1] && (
              <>
                <span>·</span>
                <span>{meta[1]}</span>
              </>
            )}
          </div>
        )}
      </div>
      {now && (
        <div
          style={{
            font: `400 11px ${t.mono}`,
            color: t.textMax,
            padding: '5px 9px',
            borderRadius: 6,
            background: t.surface3
          }}
        >
          now
        </div>
      )}
      {onDelete && (
        <button
          aria-label="Delete task"
          title="Delete task"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          style={{
            border: 'none',
            background: 'transparent',
            color: t.text6,
            fontSize: 16,
            lineHeight: 1,
            padding: '2px 4px',
            cursor: 'pointer'
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}

/** Sizing tiers from the spec: <30min blocks hide their time entirely. */
const TimeBlock: React.FC<{
  task: Task
  startHour: number
  current: boolean
  /** Faded while it is being dragged. */
  dragging?: boolean
  /** Drawn as the drop preview: highlighted, and ignores the mouse. */
  preview?: boolean
  /** Its column when it overlaps an event or another task. Full width if left out. */
  lane?: Lane
  onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void
}> = ({ task, startHour, current, dragging, preview, lane, onPointerDown }) => {
  if (!isBlocked(task)) return null
  const duration = task.end - task.start
  const top = ((task.start - startHour * 60) / 60) * HOUR_PX
  const height = (duration / 60) * HOUR_PX
  const tight = duration < 45

  return (
    <div
      data-task
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        ...laneBox(lane, 46, 0),
        top,
        height,
        borderRadius: 8,
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: tight ? '2px 10px' : '8px 10px',
        background: preview ? t.surface3 : current ? t.surface2 : t.fill,
        borderLeft: `2px solid ${current || preview ? t.markerActive : t.markerIdle}`,
        opacity: dragging ? 0.3 : 1,
        cursor: onPointerDown ? 'grab' : undefined,
        userSelect: 'none',
        pointerEvents: preview ? 'none' : undefined,
        zIndex: preview ? 1 : undefined
      }}
    >
      <div
        style={{
          fontSize: tight ? 11.5 : 12.5,
          lineHeight: tight ? 1.1 : 1.3,
          color: current ? t.text2 : '#bebebe',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {task.title}
      </div>
      {duration >= 30 && (
        <div
          style={{
            font: `400 ${tight ? 9.5 : 10.5}px/1.1 ${t.mono}`,
            color: current ? t.textMax : t.text4,
            marginTop: tight ? 1 : 3
          }}
        >
          {fmtRange(task.start, task.end)}
        </div>
      )}
    </div>
  )
}

const DayRail: React.FC<{
  tasks: Task[]
  nowMinutes: number
  floor?: number
  end?: number
  /** Attached to the hour grid, so a drag can tell where on it the pointer is. */
  gridRef?: React.Ref<HTMLDivElement>
  /** The block being dragged, faded in place. */
  draggingId?: string
  /** Where the dragged task would land, drawn as a highlighted block. */
  preview?: Task
  onBlockPointerDown?: (id: string, event: React.PointerEvent<HTMLElement>) => void
  /** Today's timed calendar events. */
  eventBlocks?: DayBlock<CalendarEvent>[]
  /** Today's all-day calendar events, shown above the hours. */
  allDay?: CalendarEvent[]
}> = ({
  tasks,
  nowMinutes,
  floor,
  end,
  gridRef,
  draggingId,
  preview,
  onBlockPointerDown,
  eventBlocks = [],
  allDay = []
}) => {
  const { startHour, endHour } = useMemo(() => railRange(tasks, floor, end), [tasks, floor, end])
  const hasBlocks = tasks.some(isBlocked)
  const lanes = layoutLanes([
    ...tasks.filter(isBlocked).map((task) => ({ id: task.id, start: task.start, end: task.end })),
    ...eventBlocks.map((b) => ({ id: b.task.id, start: b.start, end: b.end }))
  ])
  const hours = endHour - startHour
  const nowTop = ((nowMinutes - startHour * 60) / 60) * HOUR_PX
  const nowVisible = nowTop >= 0 && nowTop <= hours * HOUR_PX

  const railRef = useRef<HTMLElement>(null)
  const didScroll = useRef(false)
  useEffect(() => {
    if (didScroll.current || !railRef.current) return
    railRef.current.scrollTop = Math.max(0, nowTop - 150)
    didScroll.current = true
  }, [nowTop])

  return (
    <aside
      ref={railRef}
      style={{
        width: 330,
        flex: 'none',
        padding: '26px 22px',
        position: 'relative',
        overflowY: 'auto'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ ...eyebrow, fontSize: 11, color: t.text4 }}>Time</div>
        <div style={{ font: `400 11px ${t.mono}`, color: hasBlocks ? t.textMax : t.text6 }}>
          {hasBlocks ? `${fmtDuration(blockedMinutes(tasks))} blocked` : 'Nothing Blocked'}
        </div>
      </div>

      {allDay.length > 0 && (
        <div
          style={{
            marginTop: 14,
            marginLeft: 46,
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          {allDay.map((event) => (
            <AllDayChip key={event.id} event={event} />
          ))}
        </div>
      )}

      <div
        ref={gridRef}
        style={{ marginTop: 18, position: 'relative', height: hours * HOUR_PX + HOUR_PX }}
      >
        {Array.from({ length: hours + 1 }, (_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              top: i * HOUR_PX,
              width: 34,
              font: `400 10.5px ${t.mono}`,
              color: t.text5
            }}
          >
            {String((startHour + i) % 24).padStart(2, '0')}
          </div>
        ))}

        <div
          style={{
            position: 'absolute',
            left: 46,
            right: 0,
            top: 0,
            height: '100%',
            background: `linear-gradient(${t.hairline} 1px,transparent 1px)`,
            backgroundSize: `100% ${HOUR_PX}px`
          }}
        />

        {!hasBlocks && eventBlocks.length === 0 && (
          <div
            style={{
              position: 'absolute',
              left: 46,
              right: 0,
              top: 0,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <div style={{ font: `400 11px ${t.mono}`, color: t.text6, textAlign: 'center' }}>
              No Blocks Today
            </div>
          </div>
        )}

        {eventBlocks.map((block) => (
          <EventBlock
            key={block.task.id}
            event={block.task}
            start={block.start}
            end={block.end}
            box={{
              ...laneBox(lanes.get(block.task.id), 46, 0),
              top: ((block.start - startHour * 60) / 60) * HOUR_PX,
              height: ((block.end - block.start) / 60) * HOUR_PX
            }}
          />
        ))}

        {tasks.filter(isBlocked).map((task) => (
          <TimeBlock
            key={task.id}
            task={task}
            startHour={startHour}
            current={nowMinutes >= task.start && nowMinutes < task.end}
            lane={lanes.get(task.id)}
            dragging={draggingId === task.id}
            onPointerDown={(e) => onBlockPointerDown?.(task.id, e)}
          />
        ))}

        {/* Preview of where the dragged task will land */}
        {preview && <TimeBlock task={preview} startHour={startHour} current={false} preview />}

        {nowVisible && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: nowTop,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: t.textMax }} />
            <div style={{ flex: 1, height: 1, background: t.textMax, opacity: 0.5 }} />
            <div style={{ font: `400 10px ${t.mono}`, color: t.textMax }}>{fmt(nowMinutes)}</div>
          </div>
        )}
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------- view */

const UpcomingList: React.FC<{
  tasks: Task[]
  today: Date
  onToggle?: (id: string) => void
  onOpen?: (id: string) => void
  onDelete?: (id: string) => void
}> = ({ tasks, today, onToggle, onOpen, onDelete }) => {
  if (tasks.length === 0) {
    return (
      <EmptyNote hint="Give a task a date in New task to see it here.">
        Nothing coming up.
      </EmptyNote>
    )
  }

  // Tasks arrive sorted by day, so each day is one run of consecutive tasks.
  const groups: { day: string; tasks: Task[] }[] = []
  for (const task of tasks) {
    const last = groups[groups.length - 1]
    if (last && last.day === task.day) last.tasks.push(task)
    else groups.push({ day: task.day ?? '', tasks: [task] })
  }

  return (
    <>
      {groups.map((group, i) => (
        <div key={group.day} style={{ marginTop: i === 0 ? 0 : 14 }}>
          <div style={{ ...eyebrow, marginBottom: 8 }}>{dayHeading(group.day, today)}</div>
          {group.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={() => onToggle?.(task.id)}
              onOpen={() => onOpen?.(task.id)}
              onDelete={() => onDelete?.(task.id)}
            />
          ))}
        </div>
      ))}
    </>
  )
}

/** Splits an already-sorted list into runs that share a key, such as one run per day. */
const runsBy = (tasks: Task[], key: (task: Task) => string): { key: string; tasks: Task[] }[] => {
  const runs: { key: string; tasks: Task[] }[] = []
  for (const task of tasks) {
    const last = runs[runs.length - 1]
    if (last && last.key === key(task)) last.tasks.push(task)
    else runs.push({ key: key(task), tasks: [task] })
  }
  return runs
}

/** Groups of task rows, each under a heading. */
const TaskGroups: React.FC<{
  groups: { key: string; heading: string; tasks: Task[] }[]
  onToggle?: (id: string) => void
  onOpen?: (id: string) => void
  onDelete?: (id: string) => void
  /** The task being dragged, faded in place */
  draggingId?: string
  /** Makes the rows draggable. */
  onRowPointerDown?: (id: string, event: React.PointerEvent<HTMLElement>) => void
}> = ({ groups, onToggle, onOpen, onDelete, draggingId, onRowPointerDown }) => (
  <>
    {groups.map((group, i) => (
      <div key={group.key} style={{ marginTop: i === 0 ? 0 : 14 }}>
        <div style={{ ...eyebrow, marginBottom: 8 }}>{group.heading}</div>
        {group.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onToggle={() => onToggle?.(task.id)}
            onOpen={() => onOpen?.(task.id)}
            onDelete={() => onDelete?.(task.id)}
            dragging={draggingId === task.id}
            onPointerDown={onRowPointerDown && ((e) => onRowPointerDown(task.id, e))}
          />
        ))}
      </div>
    ))}
  </>
)

/** The Done tab: finished tasks grouped by the day they were ticked off. */
const DoneList: React.FC<{
  tasks: Task[]
  today: Date
  onToggle?: (id: string) => void
  onOpen?: (id: string) => void
  onDelete?: (id: string) => void
}> = ({ tasks, today, onToggle, onOpen, onDelete }) => {
  if (tasks.length === 0) {
    return <EmptyNote hint="Tick a task off and it lands here.">Nothing finished yet.</EmptyNote>
  }
  const todayKey = localDay(today)
  const yesterdayKey = localDay(addDays(today, -1))
  const heading = (key: string): string =>
    key === todayKey ? 'Today' : key === yesterdayKey ? 'Yesterday' : dayHeading(key, today)
  const groups = runsBy(tasks, (task) => localDay(new Date(task.doneAt ?? 0))).map((run) => ({
    ...run,
    heading: heading(run.key)
  }))
  return <TaskGroups groups={groups} onToggle={onToggle} onOpen={onOpen} onDelete={onDelete} />
}

/** The search page: a box, and every matching task grouped by its day. */
const SearchView: React.FC<{
  query: string
  onQuery: (query: string) => void
  results: Task[]
  today: Date
  onToggle?: (id: string) => void
  onOpen?: (id: string) => void
  onDelete?: (id: string) => void
}> = ({ query, onQuery, results, today, onToggle, onOpen, onDelete }) => {
  const todayKey = localDay(today)
  const heading = (key: string): string =>
    key === '' ? 'No date' : key === todayKey ? 'Today' : dayHeading(key, today)
  const groups = runsBy(results, (task) => task.day ?? '').map((run) => ({
    ...run,
    heading: heading(run.key)
  }))
  return (
    <>
      <input
        autoFocus
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onQuery('')
        }}
        placeholder="Search tasks and notes..."
        aria-label="Search tasks"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          marginBottom: 18,
          padding: '10px 14px',
          border: `1px solid ${t.strokeControl}`,
          borderRadius: 10,
          outline: 'none',
          background: t.control,
          color: t.text1,
          fontFamily: t.serif,
          fontSize: 15
        }}
      />
      {query.trim() === '' ? (
        <EmptyNote hint="Searches titles and notes of every task, finished ones too.">
          Type to search.
        </EmptyNote>
      ) : groups.length === 0 ? (
        <EmptyNote>No tasks match “{query.trim()}”.</EmptyNote>
      ) : (
        <TaskGroups groups={groups} onToggle={onToggle} onOpen={onOpen} onDelete={onDelete} />
      )}
    </>
  )
}

/** "Yesterday" for yesterday, otherwise a short date such as "Tue, Nov 10". */
const pastDayLabel = (day: string, today: Date): string => {
  if (day === localDay(addDays(today, -1))) return 'Yesterday'
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(y !== today.getFullYear() ? { year: 'numeric' } : {})
  })
}

/** The Overdue tab: unfinished tasks from earlier days, grouped by their day */
const OverdueList: React.FC<{
  tasks: Task[]
  today: Date
  onToggle?: (id: string) => void
  onOpen?: (id: string) => void
  onDelete?: (id: string) => void
  draggingId?: string
  onRowPointerDown?: (id: string, event: React.PointerEvent<HTMLElement>) => void
}> = ({ tasks, today, onToggle, onOpen, onDelete, draggingId, onRowPointerDown }) => {
  if (tasks.length === 0) {
    return (
      <EmptyNote hint="Unfinished tasks from past days show up here.">Nothing overdue.</EmptyNote>
    )
  }
  const yesterdayKey = localDay(addDays(today, -1))
  const groups = runsBy(tasks, (task) => task.day ?? '').map((run) => ({
    ...run,
    heading: run.key === yesterdayKey ? 'Yesterday' : dayHeading(run.key, today)
  }))
  return (
    <TaskGroups
      groups={groups}
      onToggle={onToggle}
      onOpen={onOpen}
      onDelete={onDelete}
      draggingId={draggingId}
      onRowPointerDown={onRowPointerDown}
    />
  )
}

/** How many overdue tasks the Today tab shows before pointing to the Overdue tab. */
const OVERDUE_PREVIEW = 3

const TABS = ['Today', 'Overdue', 'Inbox', 'Upcoming', 'Done'] as const

export const TodayView: React.FC<TodayViewProps> = ({
  date,
  tasks,
  upcoming = [],
  overdue = [],
  week = [],
  events = [],
  weekEvents = [],
  connections = [],
  onRemoveConnection,
  onConnectGoogle,
  onReconnectConnection,
  onCancelSignIn,
  onSyncConnections,
  onAddSampleCalendar,
  done: doneTasks = [],
  onSearch,
  weekStart,
  onChangeWeek,
  counts,
  activeNav = 'today',
  nowMinutes,
  onToggleTask,
  onNewTask,
  onUpdateTask,
  onDeleteTask,
  onNavigate,
  railFloorHour = 0,
  railEndHour = 24
}) => {
  const [adding, setAdding] = useState(false)
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>('Today')
  const [draft, setDraft] = useState('')
  const [day, setDay] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Search as you type. It runs again whenever the task lists reload, so ticks
  // and edits made from the results show up straight away.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Task[]>([])
  useEffect(() => {
    if (activeNav !== 'search' || !onSearch) return
    let stale = false // a newer search has started; ignore this one's answer
    onSearch(query)
      .then((found) => {
        if (!stale) setResults(found)
      })
      .catch((err) => console.error('Search failed', err))
    return () => {
      stale = true
    }
  }, [activeNav, onSearch, query, tasks, upcoming, doneTasks])
  const formRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!adding) return
    const onDown = (e: PointerEvent): void => {
      const target = e.target as HTMLElement
      // Clicks on tasks are left to onOpenTask, which switches or closes the form.
      if (target.closest('[data-task]')) return
      if (formRef.current && !formRef.current.contains(target)) setAdding(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [adding])
  const open = tasks.filter((task) => !task.done)
  const done = tasks.filter((task) => task.done)
  const current = open.find(
    (task) => isBlocked(task) && nowMinutes >= task.start && nowMinutes < task.end
  )
  const scheduled = open.filter((task) => task.start != null && task.id !== current?.id)
  const unscheduled = open.filter((task) => task.start == null)
  const isEmpty = open.length === 0
  /** Once anything exists, empty sections explain themselves instead of vanishing. */
  const showSections = !isEmpty

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    background: 'transparent', // no fill
    border: 'none',
    borderBottom: '1px solid rgba(255,255,255,.06)', // just a hairline underline
    outline: 'none',
    padding: '9px 2px',
    color: t.text1,
    fontFamily: t.serif,
    fontSize: 13,
    colorScheme: 'dark'
  }

  const submitNewTask = async (): Promise<void> => {
    const title = draft.trim()
    if (!title) return

    const start = toMinutes(startTime)
    let end = toMinutes(endTime)
    if (end != null && start == null) {
      setError('Set a start time too.')
      return
    }

    // A start with no end gets a 30-minute block.
    if (start != null && end == null) end = start + 30
    if (start != null && end != null && end === start) {
      setError('End time must be after the start time.')
      return
    }
    if (start != null && end != null && end < start) end += 24 * 60

    const input: NewTaskInput = {
      title,
      day: day || (start != null ? localDay(date) : undefined),
      notes: notes.trim() || undefined,
      start,
      end
    }

    try {
      if (editingId) await onUpdateTask?.(editingId, input)
      else await onNewTask?.(input)
      fillForm()
      setAdding(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Loads a task into the form, or clears the form when called with nothing. */
  const fillForm = (task?: Task): void => {
    setEditingId(task?.id ?? null)
    setDraft(task?.title ?? '')
    setDay(task?.day ?? '')
    setStartTime(task?.start != null ? fmt(task.start) : '')
    setEndTime(task?.end != null ? fmt(task.end) : '')
    setNotes(task?.notes ?? '')
    setError(null)
  }

  /** Finds a task in any list the app has loaded, including search results. */
  const findAnyTask = (id: string): Task | undefined =>
    [...tasks, ...overdue, ...upcoming, ...week, ...doneTasks, ...results].find(
      (item) => item.id === id
    )

  /** Clicking a task row opens it in the form for editing */
  const onOpenTask = (id: string): void => {
    // Clicking the task that is already open closes the form again.
    if (adding && editingId === id) {
      setAdding(false)
      return
    }
    const task = findAnyTask(id)
    if (!task) return
    fillForm(task)
    setAdding(true)
  }

  /** Drag and drop: gives a task a new day and time, keeping its title and notes. */
  const moveTask = (id: string, to: { day?: string; start?: number; end?: number }): void => {
    const task = findAnyTask(id)
    if (!task) return
    if (editingId === id) setAdding(false) // the open form would show the old time
    onUpdateTask?.(id, { title: task.title, notes: task.notes, ...to }).catch((err) =>
      console.error('Failed to move task', err)
    )
  }

  // Dragging on the Today page. Rows in the list and blocks on the timeline share
  // one drag, so a task can go from either onto the timeline (it gets a time) or
  // into the Unscheduled section (it loses its time).
  const railGridRef = useRef<HTMLDivElement>(null)
  const unscheduledRef = useRef<HTMLDivElement>(null)
  const dragFrom = useRef<'list' | 'rail'>('list')
  const [todayTarget, setTodayTarget] = useState<TodayDrop | null>(null)

  /** The tasks that can be dragged on the Today page: today's and the overdue ones. */
  const findTodayTask = (id: string): Task | undefined =>
    tasks.find((item) => item.id === id) ?? overdue.find((item) => item.id === id)

  const todayDropTarget = (d: BlockDrag): TodayDrop | null => {
    const task = findTodayTask(d.id)
    if (!task) return null
    const grid = railGridRef.current?.getBoundingClientRect()
    if (grid && d.x >= grid.left && d.x <= grid.right) {
      // A block dragged along the timeline moves by as far as it was dragged.
      if (dragFrom.current === 'rail' && isBlocked(task)) {
        return { kind: 'rail', ...moveBlock(task.start, task.end, (d.dy / HOUR_PX) * 60) }
      }
      // A row dragged over from the list starts where the pointer is.
      const { startHour } = railRange(tasks, railFloorHour, railEndHour)
      const min = startHour * 60 + ((d.y - grid.top) / HOUR_PX) * 60
      const length = isBlocked(task) ? task.end - task.start : NEW_BLOCK_MIN
      return { kind: 'rail', ...moveBlock(min, min + length, 0) }
    }
    const list = unscheduledRef.current?.getBoundingClientRect()
    if (list && d.x >= list.left && d.x <= list.right && d.y >= list.top && d.y <= list.bottom) {
      return { kind: 'unscheduled' }
    }
    return null
  }

  const { drag, startDrag } = useBlockDrag({
    onClick: onOpenTask,
    onDragMove: (d) => setTodayTarget(todayDropTarget(d)),
    onDrop: (d) => {
      const to = todayDropTarget(d)
      const task = findTodayTask(d.id)
      if (!to || !task) return
      const today = localDay(date)
      // An overdue task dropped anywhere on Today moves to today.
      const day = task.day ? today : undefined
      if (to.kind === 'unscheduled') {
        if (task.start != null || task.day !== day) moveTask(task.id, { day })
      } else if (to.start !== task.start || task.day !== today) {
        moveTask(task.id, { day: today, start: to.start, end: to.end })
      }
    }
  })
  // Only show drop feedback while a drag is in progress.
  const todayDrop = drag ? todayTarget : null
  const dragged = drag ? findTodayTask(drag.id) : undefined
  const dragTask = (
    from: 'list' | 'rail',
    id: string,
    event: React.PointerEvent<HTMLElement>
  ): void => {
    dragFrom.current = from
    startDrag(id, event)
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: t.shell,
        color: t.text1,
        fontFamily: t.serif,
        fontSize: 14
      }}
    >
      <IconRail active={activeNav} onNavigate={onNavigate} />

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '26px 34px 0'
          }}
        >
          <div>
            <div style={{ ...eyebrow, fontSize: 11, color: t.text4 }}>
              {date.toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long'
              })}
            </div>
            <h1
              style={{
                margin: '10px 0 0',
                fontSize: 30,
                fontWeight: 500,
                letterSpacing: '-.02em'
              }}
            >
              {activeNav === 'week'
                ? 'Week'
                : activeNav === 'search'
                  ? 'Search'
                  : activeNav === 'account'
                    ? 'Connections'
                    : 'Today'}
            </h1>
            {activeNav === 'week' && weekStart && (
              <WeekNav
                weekStart={weekStart}
                today={date}
                onChange={(start) => onChangeWeek?.(start)}
              />
            )}
          </div>
          <div ref={formRef} style={{ position: 'relative' }}>
            <button
              onClick={() => {
                if (adding && !editingId) {
                  setAdding(false)
                } else {
                  fillForm()
                  setAdding(true)
                }
              }}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderRadius: 8,
                background: t.textMax,
                color: t.shell,
                fontFamily: t.serif,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              New task
            </button>

            {adding && (
              <div
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setAdding(false)
                  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                  const tag = (e.target as HTMLElement).tagName
                  if (tag === 'BUTTON') return // the button handles Enter itself
                  if (tag === 'TEXTAREA' && !e.metaKey && !e.ctrlKey) return // new line in notes
                  e.preventDefault()
                  void submitNewTask()
                }}
                style={{
                  position: 'absolute', // float, don't take up layout space
                  top: 'calc(100% + 8px)', // 8px below the button
                  right: 0, // align to the button's right edge
                  width: 300,
                  zIndex: 20, // sit above the page content
                  background: t.control,
                  border: `1px solid ${t.strokeControl}`,
                  borderRadius: 12,
                  padding: '16px 16px 12px',
                  boxShadow: '0 12px 32px rgba(0,0,0,.45)'
                }}
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Task title…"
                  style={{ ...fieldStyle, fontSize: 16 }}
                />
                <input
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  style={{ ...fieldStyle, fontFamily: t.mono, fontSize: 12.5, color: t.text4 }}
                />
                <div style={{ display: 'flex', gap: 12 }}>
                  <input
                    type="time"
                    aria-label="Start time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    style={{
                      ...fieldStyle,
                      minWidth: 0,
                      fontFamily: t.mono,
                      fontSize: 12.5,
                      color: t.text4
                    }}
                  />
                  <input
                    type="time"
                    aria-label="End time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    style={{
                      ...fieldStyle,
                      minWidth: 0,
                      fontFamily: t.mono,
                      fontSize: 12.5,
                      color: t.text4
                    }}
                  />
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes…"
                  rows={3}
                  style={{ ...fieldStyle, borderBottom: 'none', resize: 'vertical' }}
                />
                {error && (
                  <div
                    style={{ margin: '4px 0 10px', font: `400 11px ${t.mono}`, color: '#e5484d' }}
                  >
                    {error}
                  </div>
                )}
                <button
                  onClick={() => void submitNewTask()}
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    borderRadius: 8,
                    background: t.textMax,
                    color: t.shell,
                    fontFamily: t.serif,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {editingId ? 'Save' : 'Add task'}
                </button>
              </div>
            )}
          </div>
        </header>

        <div
          style={{
            display: activeNav === 'today' ? 'flex' : 'none',
            gap: 26,
            padding: '16px 34px 0'
          }}
        >
          {TABS.map((tab) => {
            const on = tab === activeTab
            const count =
              tab === 'Today'
                ? counts?.today
                : tab === 'Overdue'
                  ? counts?.overdue
                  : tab === 'Inbox'
                    ? counts?.inbox
                    : tab === 'Upcoming'
                      ? counts?.upcoming
                      : undefined
            return (
              <div
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  paddingBottom: 12,
                  fontSize: 13,
                  color: on ? t.text1 : '#919191',
                  borderBottom: on ? `1.5px solid ${t.markerActive}` : undefined,
                  cursor: 'pointer'
                }}
              >
                {tab}
                {count != null && (
                  <span style={{ fontFamily: t.mono, color: on ? t.text4 : undefined }}>
                    {' '}
                    {count}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '22px 34px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}
        >
          {activeNav === 'week' && weekStart ? (
            <WeekView
              weekStart={weekStart}
              today={date}
              tasks={week}
              undated={tasks.filter((task) => !task.day && !task.done)}
              events={weekEvents}
              nowMinutes={nowMinutes}
              onOpen={onOpenTask}
              onMove={moveTask}
            />
          ) : activeNav === 'account' ? (
            <ConnectionsView
              connections={connections}
              onRemove={onRemoveConnection}
              onConnectGoogle={onConnectGoogle}
              onReconnect={onReconnectConnection}
              onCancelSignIn={onCancelSignIn}
              onSync={onSyncConnections}
              onAddSample={onAddSampleCalendar}
            />
          ) : activeNav === 'search' ? (
            <SearchView
              query={query}
              onQuery={setQuery}
              results={results}
              today={date}
              onToggle={onToggleTask}
              onOpen={onOpenTask}
              onDelete={onDeleteTask}
            />
          ) : activeTab === 'Overdue' ? (
            <OverdueList
              tasks={overdue}
              today={date}
              onToggle={onToggleTask}
              onOpen={onOpenTask}
              onDelete={onDeleteTask}
              draggingId={drag?.id}
              onRowPointerDown={(id, e) => dragTask('list', id, e)}
            />
          ) : activeTab === 'Inbox' ? (
            <EmptyNote hint="New Canvas assignments and calendar invites will arrive here once those are connected.">
              Nothing to sort.
            </EmptyNote>
          ) : activeTab === 'Done' ? (
            <DoneList
              tasks={doneTasks}
              today={date}
              onToggle={onToggleTask}
              onOpen={onOpenTask}
              onDelete={onDeleteTask}
            />
          ) : activeTab === 'Upcoming' ? (
            <UpcomingList
              tasks={upcoming}
              today={date}
              onToggle={onToggleTask}
              onOpen={onOpenTask}
              onDelete={onDeleteTask}
            />
          ) : (
            <>
              {overdue.length > 0 && (
                <>
                  <div
                    style={{
                      ...eyebrow,
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      marginBottom: 8
                    }}
                  >
                    <span>Overdue</span>
                    <span style={{ color: t.text6 }}>Drag to today</span>
                  </div>
                  {overdue.slice(0, OVERDUE_PREVIEW).map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      dayLabel={task.day && pastDayLabel(task.day, date)}
                      onToggle={() => onToggleTask?.(task.id)}
                      onOpen={() => onOpenTask?.(task.id)}
                      onDelete={() => onDeleteTask?.(task.id)}
                      dragging={drag?.id === task.id}
                      onPointerDown={(e) => dragTask('list', task.id, e)}
                    />
                  ))}
                  {overdue.length > OVERDUE_PREVIEW && (
                    <button
                      onClick={() => setActiveTab('Overdue')}
                      style={{
                        alignSelf: 'flex-start',
                        margin: '2px 0 0 14px',
                        padding: 0,
                        border: 'none',
                        background: 'none',
                        color: t.text4,
                        fontFamily: t.serif,
                        fontSize: 13,
                        cursor: 'pointer'
                      }}
                    >
                      See all {overdue.length} in Overdue →
                    </button>
                  )}
                  <div style={{ height: 14 }} />
                </>
              )}
              {current && (
                <>
                  <div style={{ ...eyebrow, marginBottom: 12 }}>Now</div>
                  <TaskRow
                    task={current}
                    now
                    onToggle={() => onToggleTask?.(current.id)}
                    onDelete={() => onDeleteTask?.(current.id)}
                    onOpen={() => onOpenTask?.(current.id)}
                    dragging={drag?.id === current.id}
                    onPointerDown={(e) => dragTask('list', current.id, e)}
                  />
                  <div style={{ height: 14 }} />
                </>
              )}

              {showSections && (
                <>
                  <div style={{ ...eyebrow, marginBottom: 8 }}>Scheduled</div>
                  {scheduled.length > 0 ? (
                    scheduled.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onToggle={() => onToggleTask?.(task.id)}
                        onOpen={() => onOpenTask?.(task.id)}
                        onDelete={() => onDeleteTask?.(task.id)}
                        dragging={drag?.id === task.id}
                        onPointerDown={(e) => dragTask('list', task.id, e)}
                      />
                    ))
                  ) : (
                    <EmptyNote hint="Drag one onto the rail, or press ⇧⏎ on a task.">
                      {current ? 'Nothing else blocked today.' : 'No time blocked yet.'}
                    </EmptyNote>
                  )}
                  <div style={{ height: 14 }} />

                  {/* Drop a scheduled task or a timeline block here to take its time off */}
                  <div
                    ref={unscheduledRef}
                    style={{
                      borderRadius: 10,
                      boxShadow: todayDrop?.kind === 'unscheduled' ? dropHighlight : undefined
                    }}
                  >
                    <div
                      style={{
                        ...eyebrow,
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        marginBottom: 8
                      }}
                    >
                      <span>Unscheduled</span>
                      {unscheduled.length > 0 && (
                        <span style={{ color: t.text6 }}>Drag to block</span>
                      )}
                    </div>
                    {unscheduled.length > 0 ? (
                      unscheduled.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          onToggle={() => onToggleTask?.(task.id)}
                          onOpen={() => onOpenTask?.(task.id)}
                          onDelete={() => onDeleteTask?.(task.id)}
                          dragging={drag?.id === task.id}
                          onPointerDown={(e) => dragTask('list', task.id, e)}
                        />
                      ))
                    ) : (
                      <EmptyNote>Everything today has a time.</EmptyNote>
                    )}
                  </div>
                </>
              )}

              {done.length > 0 && (
                <>
                  <div style={{ height: 14 }} />
                  <div style={{ ...eyebrow, marginBottom: 8 }}>Done</div>
                  {done.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => onToggleTask?.(task.id)}
                      onOpen={() => onOpenTask?.(task.id)}
                      onDelete={() => onDeleteTask?.(task.id)}
                    />
                  ))}
                </>
              )}

              {isEmpty && done.length === 0 && (
                <DayEmpty inboxCount={counts?.inbox} onNewTask={() => setAdding(true)} />
              )}
            </>
          )}
        </div>
      </main>
      {activeNav === 'today' && (
        <DayRail
          tasks={tasks}
          nowMinutes={nowMinutes}
          floor={railFloorHour}
          end={railEndHour}
          gridRef={railGridRef}
          draggingId={drag?.id}
          preview={
            dragged && todayDrop?.kind === 'rail'
              ? { ...dragged, start: todayDrop.start, end: todayDrop.end }
              : undefined
          }
          onBlockPointerDown={(id, e) => dragTask('rail', id, e)}
          eventBlocks={blocksForDay(events, localDay(date), localDay(addDays(date, -1)))}
          allDay={events.filter((event) => event.day === localDay(date) && event.start == null)}
        />
      )}

      {/* The task's title follows the pointer while it is off the timeline */}
      {drag && dragged && todayDrop?.kind !== 'rail' && (
        <div
          style={{
            position: 'fixed',
            left: drag.x + 12,
            top: drag.y + 8,
            maxWidth: 220,
            padding: '5px 10px',
            borderRadius: 6,
            background: t.surface3,
            color: t.text1,
            fontSize: 12.5,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
            zIndex: 30
          }}
        >
          {dragged.title}
        </div>
      )}
    </div>
  )
}

export default TodayView

/* --------------------------------------------------------------- example use

import { useEffect, useState } from 'react';
import TodayView, { type Task } from './TodayView';

export function TodayScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [now, setNow] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  // preload.ts exposes: contextBridge.exposeInMainWorld('db', { tasksForDay })
  useEffect(() => {
    window.db.tasksForDay(new Date().toISOString().slice(0, 10)).then(setTasks);
  }, []);

  // keeps the now-line and the "Now" section honest
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <TodayView
      date={new Date()}
      tasks={tasks}
      counts={{ today: tasks.length, inbox: 12 }}
      nowMinutes={now}
      onToggleTask={(id) => window.db.toggleTask(id)}
    />
  );
}

Load Newsreader once in your renderer's index.html:
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,300;6..72,400;6..72,500;6..72,600&display=swap" rel="stylesheet">
(or bundle the woff2 locally — Electron apps should not depend on the network at boot).

---------------------------------------------------------------------------- */
