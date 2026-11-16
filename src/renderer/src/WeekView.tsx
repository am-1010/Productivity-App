import { useEffect, useRef } from 'react'
import type { CSSProperties, FC } from 'react'
import type { Task } from '../../shared/types'
import { addDays, localDay, startOfWeek } from './day'
import { eyebrow, t } from './theme'
import { blocksForDay, fmt, fmtRange, isBlocked } from './time'

const HOUR_PX = 44
/** Width of the hour labels down the left side. */
const GUTTER = 40

const navButton: CSSProperties = {
  border: 'none',
  borderRadius: 6,
  background: t.surface2,
  color: t.text2,
  font: `400 11px ${t.mono}`,
  padding: '5px 9px',
  cursor: 'pointer'
}

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
  nowMinutes: number
  onOpen?: (id: string) => void
}> = ({ weekStart, today, tasks, nowMinutes, onOpen }) => {
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

  return (
    <div ref={scrollRef} style={{ flex: 1, minHeight: 0, minWidth: 620, overflowY: 'auto' }}>
      {/* Day names, dates, and tasks that have a day but no time. Stays pinned while scrolling */}
      <div
        style={{
          display: 'flex',
          paddingLeft: GUTTER,
          position: 'sticky',
          top: 0,
          zIndex: 2,
          background: t.shell
        }}
      >
        {columns.map((column) => (
          <div
            key={column.key}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '0 4px 12px',
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
                onClick={() => onOpen?.(task.id)}
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
                  cursor: 'pointer'
                }}
              >
                {task.title}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* The hour grid */}
      <div style={{ display: 'flex', height: height + 8, paddingTop: 6 }}>
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

        {columns.map((column) => (
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
              return (
                <div
                  key={block.task.id}
                  onClick={() => onOpen?.(block.task.id)}
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
                    opacity: block.task.done ? 0.45 : 1,
                    cursor: 'pointer'
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
  )
}
