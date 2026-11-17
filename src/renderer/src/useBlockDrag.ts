import { useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** Moving less than this many pixels counts as a click, not a drag */
const THRESHOLD_PX = 4

/** A drag in progress: which block, and how far the pointer has moved since it was pressed */
export interface BlockDrag {
  id: string
  dx: number
  dy: number
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
}): {
  drag: BlockDrag | null
  startDrag: (id: string, event: ReactPointerEvent<HTMLElement>) => void
} {
  const [drag, setDrag] = useState<BlockDrag | null>(null)

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
      current = { id, dx, dy, columnWidth }
      setDrag(current)
    }

    const onUp = (): void => {
      stop()
      if (current) options.onDrop(current)
      else options.onClick?.(id)
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
