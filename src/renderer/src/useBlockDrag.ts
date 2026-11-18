import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** Moving less than this many pixels counts as a click, not a drag */
const THRESHOLD_PX = 4

/** A drag in progress: which block, and how far the pointer has moved since it was pressed */
export interface BlockDrag {
  id: string
  dx: number
  dy: number
  /** Where the pointer is now, in window coordinates. */
  x: number
  y: number
  /** Width of the element the block sits in (its day column), measured when the drag began. */
  columnWidth: number
}

/**
 * Tracks dragging a time block with the mouse.
 * Call `startDrag` from the block's onPointerDown. While the pointer is down and
 * moving, `drag` holds the distance moved, so the view can draw a preview.
 * On release it calls `onDrop`, or `onClick` if the pointer barely moved.
 * Escape cancels.
 */
export function useBlockDrag(options: {
  onDrop: (drag: BlockDrag) => void
  onClick?: (id: string) => void
  /** Called on every pointer move while dragging. */
  onDragMove?: (drag: BlockDrag) => void
}): {
  drag: BlockDrag | null
  startDrag: (id: string, event: ReactPointerEvent<HTMLElement>) => void
} {
  const [drag, setDrag] = useState<BlockDrag | null>(null)

  // Always call the newest onDrop/onClick, not the ones from when the drag began.
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  const startDrag = (id: string, event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return // left button only
    event.preventDefault() // don't start selecting text

    const startX = event.clientX
    const startY = event.clientY
    const columnWidth = event.currentTarget.parentElement?.clientWidth ?? 0
    let current: BlockDrag | null = null

    const stop = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
      setDrag(null)
    }

    const onMove = (e: PointerEvent): void => {
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (!current && Math.hypot(dx, dy) < THRESHOLD_PX) return
      current = { id, dx, dy, x: e.clientX, y: e.clientY, columnWidth }
      setDrag(current)
      latest.current.onDragMove?.(current)
    }

    const onUp = (): void => {
      stop()
      if (current) latest.current.onDrop(current)
      else latest.current.onClick?.(id)
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') stop()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
  }

  return { drag, startDrag }
}
