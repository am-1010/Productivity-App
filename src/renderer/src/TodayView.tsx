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

import React, { useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { NewTaskInput, Task } from '../../shared/types'
import { localDay } from './day'

/* ------------------------------------------------------------------ tokens */

const t = {
  shell: '#070707',
  surface1: 'rgba(255,255,255,.035)',
  surface2: 'rgba(255,255,255,.055)',
  surface3: 'rgba(255,255,255,.08)',
  fill: '#131313',
  control: '#191919',
  strokeControl: '#363636',
  markerActive: '#f0f0f0',
  markerIdle: '#4d4d4d',
  hairline: 'rgba(255,255,255,.045)',
  textMax: '#f0f0f0',
  text1: '#ececec',
  text2: '#e3e3e3',
  text3: '#a0a0a0',
  text4: '#878787',
  text5: '#626262',
  text6: '#525252',
  serif: "'Newsreader',Georgia,'Times New Roman',serif",
  mono: "ui-monospace,'SF Mono',Menlo,monospace"
} as const

const eyebrow: CSSProperties = {
  font: `400 10.5px/1 ${t.mono}`,
  letterSpacing: '.14em',
  color: t.text5,
  textTransform: 'uppercase'
}

/* ------------------------------------------------------------------- types */

export interface TodayViewProps {
  date: Date
  tasks: Task[]
  upcoming?: Task[]
  /** Counts for the tab strip; supplied by the caller so this view stays dumb. */
  counts?: { today: number; inbox: number; upcoming?: number }
  activeNav?: NavKey
  /** Minutes from midnight. Pass a ticking value to animate the now-line. */
  nowMinutes: number
  onToggleTask?: (id: string) => void
  onOpenTask?: (id: string) => void
  onNewTask?: (input: NewTaskInput) => Promise<void>
  onDeleteTask?: (id: string) => void
  onNavigate?: (key: NavKey) => void
  /** Earliest hour the rail will ever show when the day starts late. */
  railFloorHour?: number
  /** Last hour label on the rail. */
  railEndHour?: number
}

export type NavKey = 'today' | 'inbox' | 'week' | 'search' | 'account'

/* --------------------------------------------------------------- utilities */

const HOUR_PX = 54

const fmt = (min: number): string =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

const fmtRange = (start: number, end?: number): string =>
  end == null ? fmt(start) : `${fmt(start)} – ${fmt(end)}`

const isBlocked = (task: Task): task is Task & { start: number; end: number } =>
  task.start != null && task.end != null

/**
 * Rail starts at `floorHour`, or earlier if something is blocked before it.
 * Returns inclusive hour bounds.
 */
function railRange(
  tasks: Task[],
  floorHour = 7,
  endHour = 17
): { startHour: number; endHour: number } {
  const blocked = tasks.filter(isBlocked)
  const earliest = blocked.reduce<number | null>(
    (min, task) => (min == null || task.start < min ? task.start : min),
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
function blockedMinutes(tasks: Task[]): number {
  return tasks.filter(isBlocked).reduce((sum, task) => sum + (task.end - task.start), 0)
}

/** 'HH:MM' from <input type="time"> → minutes from midnight. Empty → undefined. */
const toMinutes = (hhmm: string): number | undefined => {
  if (!hhmm) return undefined
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

const fmtDuration = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return [h ? `${h}h` : null, m ? `${m}m` : null].filter(Boolean).join(' ') || '0m'
}

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
    key: 'inbox',
    label: 'Inbox',
    tip: 'Inbox — new requests from Gmail, Slack and Linear waiting to be triaged',
    icon: (
      <>
        <path d="M3 11.5V6a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 17 6v5.5" />
        <path d="M3 11.5h3.6l1.1 2h4.6l1.1-2H17v2.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 3 14z" />
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
    tip: 'Search — find any task, event or inbox item',
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
      title="Account — profile, connected sources and scheduling settings"
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
}> = ({ task, now, onToggle, onOpen, onDelete }) => {
  const meta = [
    isBlocked(task) ? fmtRange(task.start, task.end) : task.start != null ? fmt(task.start) : null,
    task.project ?? (task.source ? `from ${task.source}` : null)
  ].filter(Boolean) as string[]

  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: now ? '14px' : '13px 14px',
        borderRadius: 10,
        cursor: 'pointer',
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
const TimeBlock: React.FC<{ task: Task; startHour: number; current: boolean }> = ({
  task,
  startHour,
  current
}) => {
  if (!isBlocked(task)) return null
  const duration = task.end - task.start
  const top = ((task.start - startHour * 60) / 60) * HOUR_PX
  const height = (duration / 60) * HOUR_PX
  const tight = duration < 45

  return (
    <div
      style={{
        position: 'absolute',
        left: 46,
        right: 0,
        top,
        height,
        borderRadius: 8,
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: tight ? '2px 10px' : '8px 10px',
        background: current ? t.surface2 : t.fill,
        borderLeft: `2px solid ${current ? t.markerActive : t.markerIdle}`
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

const DayRail: React.FC<{ tasks: Task[]; nowMinutes: number; floor?: number; end?: number }> = ({
  tasks,
  nowMinutes,
  floor,
  end
}) => {
  const { startHour, endHour } = useMemo(() => railRange(tasks, floor, end), [tasks, floor, end])
  const hasBlocks = tasks.some(isBlocked)
  const hours = endHour - startHour
  const nowTop = ((nowMinutes - startHour * 60) / 60) * HOUR_PX
  const nowVisible = nowTop >= 0 && nowTop <= hours * HOUR_PX

  return (
    <aside
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

      <div style={{ marginTop: 18, position: 'relative', height: hours * HOUR_PX + HOUR_PX }}>
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

        {!hasBlocks && (
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

        {tasks.filter(isBlocked).map((task) => (
          <TimeBlock
            key={task.id}
            task={task}
            startHour={startHour}
            current={nowMinutes >= task.start! && nowMinutes < task.end!}
          />
        ))}

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

/** 'YYYY-MM-DD' → a heading like "Tomorrow" or "Thursday, 12 November". */
const dayHeading = (day: string, today: Date): string => {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  if (date.getTime() === tomorrow.getTime()) return 'Tomorrow'
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(y !== today.getFullYear() ? { year: 'numeric' } : {})
  })
}

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

const TABS = ['Today', 'Inbox', 'Upcoming', 'Done'] as const

export const TodayView: React.FC<TodayViewProps> = ({
  date,
  tasks,
  upcoming = [],
  counts,
  activeNav = 'today',
  nowMinutes,
  onToggleTask,
  onOpenTask,
  onNewTask,
  onDeleteTask,
  onNavigate,
  railFloorHour = 7,
  railEndHour = 17
}) => {
  const [adding, setAdding] = useState(false)
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>('Today')
  const [draft, setDraft] = useState('')
  const [day, setDay] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
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
    if (!title || !onNewTask) return

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

    try {
      await onNewTask({
        title,
        day: day || (start != null ? localDay(date) : undefined),
        notes: notes.trim() || undefined,
        start,
        end
      })
      setDraft('')
      setDay('')
      setStartTime('')
      setEndTime('')
      setNotes('')
      setError(null)
      setAdding(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
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
              Today
            </h1>
          </div>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setAdding((v) => !v)}
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
                style={{
                  position: 'absolute', // float, don't take up layout space
                  top: 'calc(100% + 8px)', // 8px below the button
                  right: 0, // align to the button's right edge
                  width: 300,
                  zIndex: 20, // sit above the page content
                  background: 'rgba(255,255,255,.025)',
                  borderRadius: 12,
                  padding: '16px 16px 12px',
                  boxShadow: '0 12px 32px rgba(0,0,0,.45)'
                }}
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitNewTask()
                    if (e.key === 'Escape') setAdding(false)
                  }}
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
                  Add task
                </button>
              </div>
            )}
          </div>
        </header>

        <div style={{ display: 'flex', gap: 26, padding: '16px 34px 0' }}>
          {TABS.map((tab) => {
            const on = tab === activeTab
            const enabled = tab === 'Today' || tab === 'Upcoming'
            const count =
              tab === 'Today'
                ? counts?.today
                : tab === 'Inbox'
                  ? counts?.inbox
                  : tab === 'Upcoming'
                    ? counts?.upcoming
                    : undefined
            return (
              <div
                key={tab}
                onClick={enabled ? () => setActiveTab(tab) : undefined}
                style={{
                  paddingBottom: 12,
                  fontSize: 13,
                  color: on ? t.text1 : enabled ? '#919191' : t.text6,
                  borderBottom: on ? `1.5px solid ${t.markerActive}` : undefined,
                  cursor: enabled ? 'pointer' : 'default'
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
          {activeTab === 'Upcoming' ? (
            <UpcomingList
              tasks={upcoming}
              today={date}
              onToggle={onToggleTask}
              onOpen={onOpenTask}
              onDelete={onDeleteTask}
            />
          ) : (
            <>
              {current && (
                <>
                  <div style={{ ...eyebrow, marginBottom: 12 }}>Now</div>
                  <TaskRow
                    task={current}
                    now
                    onToggle={() => onToggleTask?.(current.id)}
                    onDelete={() => onDeleteTask?.(current.id)}
                    onOpen={() => onOpenTask?.(current.id)}
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
                      />
                    ))
                  ) : (
                    <EmptyNote hint="Drag one onto the rail, or press ⇧⏎ on a task.">
                      {current ? 'Nothing else blocked today.' : 'No time blocked yet.'}
                    </EmptyNote>
                  )}
                  <div style={{ height: 14 }} />

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
                      />
                    ))
                  ) : (
                    <EmptyNote>Everything today has a time.</EmptyNote>
                  )}
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

      <DayRail tasks={tasks} nowMinutes={nowMinutes} floor={railFloorHour} end={railEndHour} />
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
