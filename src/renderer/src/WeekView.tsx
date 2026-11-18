import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, FC } from 'react'
import type { Task } from '../../shared/types'
import { addDays, localDay, startOfWeek } from './day'
import { eyebrow, t } from './theme'
import { blocksForDay, fmt, fmtRange, isBlocked, moveBlock } from './time'
import { useBlockDrag, type BlockDrag } from './useBlockDrag'

const HOUR_PX = 44
/** Width of the hour labels down the left side. */
const GUTTER = 40
/** Length given to a task with no time when it is dragged onto the grid. */
const NEW_BLOCK_MIN = 30
/** Space above 00:00 in the hour grid. */
const GRID_PAD = 6

const navButton: CSSProperties = {
  border: 'none',
  borderRadius: 6,
  background: t.surface2,
  color: t.text2,
  font: `400 11px ${t.mono}`,
  padding: '5px 9px',
  cursor: 'pointer'
}

/** Outline drawn round a place a task can be dropped. */
const dropHighlight = `inset 0 0 0 1px ${t.markerActive}`

/** Where a dragged task will land. */
type Drop =
  | { kind: 'grid'; column: number; day: string; start: number; end: number }
  | { kind: 'untimed'; column: number; day: string }
  | { kind: 'undated' }

const shortDate = (d: Date): string =>
  d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** "‹ 9 Nov – 15 Nov ›  This week": moves the week view back and forth. */
export const WeekNav: FC<{ weekStart: Date; today: Date; onChange: (start: Date) => void }> = ({
  weekStart,
  today,
  onChange
}) => (
  <div
    style={{
      marginTop: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      font: `400 11px ${t.mono}`,
      color: t.text4
    }}
  >
    <button
      aria-label="Previous week"
      onClick={() => onChange(addDays(weekStart, -7))}
      style={navButton}
    >
      ‹
    </button>
    <span>
      {shortDate(weekStart)} – {shortDate(addDays(weekStart, 6))}
    </span>
    <button
      aria-label="Next week"
      onClick={() => onChange(addDays(weekStart, 7))}
      style={navButton}
    >
      ›
    </button>
    <button onClick={() => onChange(startOfWeek(today))} style={navButton}>
      This week
    </button>
  </div>
)

/** Seven day columns, Monday to Sunday, on one shared hour grid. */
export const WeekView: FC<{
  weekStart: Date
  today: Date
  /** Tasks for the week, plus the day before it (for blocks that run past midnight). */
  tasks: Task[]
  /** Open tasks with no date, shown in the tray at the bottom. */
  undated: Task[]
  nowMinutes: number
  onOpen?: (id: string) => void
  /** Called when a task is dragged somewhere new. A missing day or time clears it. */
  onMove?: (id: string, to: { day?: string; start?: number; end?: number }) => void
}> = ({ weekStart, today, tasks, undated, nowMinutes, onOpen, onMove }) => {
  const todayKey = localDay(today)
  const columns = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i)
    const key = localDay(date)
    return {
      date,
      key,
      isToday: key === todayKey,
      blocks: blocksForDay(tasks, key, localDay(addDays(date, -1))),
      untimed: tasks.filter((task) => task.day === key && !isBlocked(task))
    }
  })

  // The grid covers always covers the whole day, 00:00 to 24:00, and scrolls
  const startHour = 0
  const endHour = 24
  const height = (endHour - startHour) * HOUR_PX
  const nowTop = ((nowMinutes - startHour * 60) / 60) * HOUR_PX

  // When the view first opens, scroll so the current time is in sight.
  const scrollRef = useRef<HTMLDivElement>(null)
  const didScroll = useRef(false)
  useEffect(() => {
    if (didScroll.current || !scrollRef.current) return
    scrollRef.current.scrollTop = Math.max(0, nowTop - 150)
    didScroll.current = true
  }, [nowTop])

  const headerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const [trayOpen, setTrayOpen] = useState(false)
  const [target, setTarget] = useState<Drop | null>(null)
  const findTask = (id: string): Task | undefined =>
    [...tasks, ...undated].find((item) => item.id === id)

  /** Where a dragged task would land: in the tray, under a date, or on the grid. */
  const dropTarget = (d: BlockDrag): Drop | null => {
    const task = findTask(d.id)
    const grid = gridRef.current?.getBoundingClientRect()
    const header = headerRef.current?.getBoundingClientRect()
    const tray = trayRef.current?.getBoundingClientRect()
    if (!task || !grid || !header) return null
    if (tray && d.y >= tray.top) return { kind: 'undated' }

    // The column under the pointer.
    const columnWidth = (grid.width - GUTTER) / 7
    const column = Math.min(6, Math.max(0, Math.floor((d.x - grid.left - GUTTER) / columnWidth)))
    const day = columns[column].key
    if (d.y <= header.bottom) return { kind: 'untimed', column, day }

    // On the grid. A timed block moves by as far as it was dragged; a task with
    // no time gets a 30-minute slot where the pointer is.
    if (isBlocked(task)) {
      return {
        kind: 'grid',
        column,
        day,
        ...moveBlock(task.start, task.end, (d.dy / HOUR_PX) * 60)
      }
    }
    const min = ((d.y - grid.top - GRID_PAD) / HOUR_PX) * 60
    return { kind: 'grid', column, day, ...moveBlock(min, min + NEW_BLOCK_MIN, 0) }
  }

  const { drag, startDrag } = useBlockDrag({
    onClick: onOpen,
    onDragMove: (d) => setTarget(dropTarget(d)),
    onDrop: (d) => {
      const to = dropTarget(d)
      const task = findTask(d.id)
      if (!to || !task) return
      if (to.kind === 'undated') {
        if (task.day) onMove?.(task.id, {})
      } else if (to.kind === 'untimed') {
        if (task.day !== to.day || task.start != null) onMove?.(task.id, { day: to.day })
      } else if (task.day !== to.day || task.start !== to.start) {
        onMove?.(task.id, { day: to.day, start: to.start, end: to.end })
      }
    }
  })
  // Only draw the drop preview while a drag is in progress.
  const drop = drag ? target : null

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, minWidth: 620, overflowY: 'auto' }}>
        {/* Day names, dates, and tasks that have a day but no time. Stays pinned while scrolling */}
        <div
          ref={headerRef}
          style={{
            display: 'flex',
            paddingLeft: GUTTER,
            position: 'sticky',
            top: 0,
            zIndex: 2,
            background: t.shell
          }}
        >
          {columns.map((column, columnIndex) => (
            <div
              key={column.key}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '0 4px 12px',
                borderRadius: 8,
                boxShadow:
                  drop?.kind === 'untimed' && drop.column === columnIndex
                    ? dropHighlight
                    : undefined,
                opacity: column.date.getDay() % 6 === 0 ? 0.7 : 1 // dim Sat and Sun
              }}
            >
              <div style={{ ...eyebrow, color: column.isToday ? t.textMax : t.text5 }}>
                {column.date.toLocaleDateString(undefined, { weekday: 'short' })}
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 20,
                  fontWeight: 500,
                  color: column.isToday ? t.textMax : t.text3
                }}
              >
                {column.date.getDate()}
              </div>
              {column.untimed.map((task) => (
                <div
                  key={task.id}
                  onPointerDown={(e) => startDrag(task.id, e)}
                  title={task.title}
                  style={{
                    marginTop: 6,
                    padding: '4px 6px',
                    borderRadius: 6,
                    background: t.surface1,
                    fontSize: 12,
                    color: task.done ? t.text5 : t.text2,
                    textDecoration: task.done ? 'line-through' : undefined,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    opacity: drag?.id === task.id ? 0.3 : 1,
                    cursor: 'grab',
                    userSelect: 'none'
                  }}
                >
                  {task.title}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* The hour grid */}
        <div ref={gridRef} style={{ display: 'flex', height: height + 8, paddingTop: GRID_PAD }}>
          <div style={{ width: GUTTER, flex: 'none', position: 'relative' }}>
            {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  top: i * HOUR_PX - 5,
                  font: `400 10px ${t.mono}`,
                  color: t.text5
                }}
              >
                {String((startHour + i) % 24).padStart(2, '0')}
              </div>
            ))}
          </div>

          {columns.map((column, columnIndex) => (
            <div
              key={column.key}
              style={{
                flex: 1,
                minWidth: 0,
                height,
                position: 'relative',
                borderLeft: `1px solid ${t.hairline}`,
                background: `linear-gradient(${t.hairline} 1px,transparent 1px)`,
                backgroundSize: `100% ${HOUR_PX}px`
              }}
            >
              {column.blocks.map((block) => {
                const top = ((block.start - startHour * 60) / 60) * HOUR_PX
                const blockHeight = Math.max(((block.end - block.start) / 60) * HOUR_PX, 16)
                // The piece on the task's own day can be dragged. The piece that
                // spills past midnight into the next day only opens the editor.
                const draggable = block.task.day === column.key
                const dragging = drag?.id === block.task.id

                return (
                  <div
                    key={block.task.id}
                    onPointerDown={draggable ? (e) => startDrag(block.task.id, e) : undefined}
                    onClick={draggable ? undefined : () => onOpen?.(block.task.id)}
                    title={`${block.task.title} · ${fmtRange(block.task.start, block.task.end)}`}
                    style={{
                      position: 'absolute',
                      left: 3,
                      right: 3,
                      top,
                      height: blockHeight,
                      boxSizing: 'border-box',
                      padding: '3px 6px',
                      borderRadius: 6,
                      overflow: 'hidden',
                      background: column.isToday ? t.surface2 : t.fill,
                      borderLeft: `2px solid ${column.isToday ? t.markerActive : t.markerIdle}`,
                      opacity: dragging ? 0.3 : block.task.done ? 0.45 : 1,
                      cursor: draggable ? 'grab' : 'pointer',
                      userSelect: 'none'
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11.5,
                        lineHeight: 1.2,
                        color: t.text2,
                        textDecoration: block.task.done ? 'line-through' : undefined,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {block.task.title}
                    </div>
                    {blockHeight >= 30 && (
                      <div style={{ marginTop: 2, font: `400 9.5px ${t.mono}`, color: t.text4 }}>
                        {fmt(block.start)}–{fmt(block.end)}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Preview of where the dragged block will land */}
              {drop?.kind === 'grid' && drop.column === columnIndex && (
                <div
                  style={{
                    position: 'absolute',
                    left: 3,
                    right: 3,
                    top: (drop.start / 60) * HOUR_PX,
                    height: Math.max(((Math.min(drop.end, 1440) - drop.start) / 60) * HOUR_PX, 16),
                    boxSizing: 'border-box',
                    padding: '3px 6px',
                    borderRadius: 6,
                    background: t.surface3,
                    border: `1px solid ${t.markerActive}`,
                    font: `400 9.5px ${t.mono}`,
                    color: t.textMax,
                    pointerEvents: 'none',
                    zIndex: 1
                  }}
                >
                  {fmtRange(drop.start, drop.end)}
                </div>
              )}

              {column.isToday && nowTop >= 0 && nowTop <= height && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: nowTop,
                    height: 1,
                    background: t.textMax
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Tasks with no date. Click the bar to open it; it also opens during a drag. */}
      <div
        ref={trayRef}
        style={{
          flex: 'none',
          marginTop: 8,
          padding: '8px 10px',
          borderRadius: 8,
          background: t.surface1,
          boxShadow: drop?.kind === 'undated' ? dropHighlight : undefined
        }}
      >
        <button
          onClick={() => setTrayOpen(!trayOpen)}
          style={{ ...navButton, background: 'transparent', padding: 0 }}
        >
          {trayOpen || drag ? '▾' : '▴'} No date · {undated.length}
        </button>
        {(trayOpen || drag) && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 8,
              maxHeight: 96,
              overflowY: 'auto'
            }}
          >
            {undated.length === 0 && (
              <div style={{ fontSize: 12, color: t.text5 }}>
                Nothing here. Drop a task here to take its date off.
              </div>
            )}
            {undated.map((task) => (
              <div
                key={task.id}
                onPointerDown={(e) => startDrag(task.id, e)}
                title={task.title}
                style={{
                  maxWidth: 180,
                  padding: '4px 8px',
                  borderRadius: 6,
                  background: t.surface2,
                  fontSize: 12,
                  color: t.text2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  opacity: drag?.id === task.id ? 0.3 : 1,
                  cursor: 'grab',
                  userSelect: 'none'
                }}
              >
                {task.title}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
