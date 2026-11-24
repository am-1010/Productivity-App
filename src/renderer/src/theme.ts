import type { CSSProperties } from 'react'
import type { Lane } from './time'

export const t = {
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

export const eyebrow: CSSProperties = {
  font: `400 10.5px/1 ${t.mono}`,
  letterSpacing: '.14em',
  color: t.text5,
  textTransform: 'uppercase'
}

/** Outline drawn round a place a dragged task can be dropped. */
export const dropHighlight = `inset 0 0 0 1px ${t.markerActive}`

/**
 * Left edge and width for a block in column `lane` of `lanes`, inside a box that
 * keeps `left` px clear on the left and `right` px on the right.
 */
export const laneBox = (lane: Lane | undefined, left: number, right: number): CSSProperties => {
  const { lane: i, lanes } = lane ?? { lane: 0, lanes: 1 }
  const gap = lanes > 1 ? 2 : 0
  return {
    left: `calc(${left}px + (100% - ${left + right}px) * ${i / lanes})`,
    width: `calc((100% - ${left + right}px) / ${lanes} - ${gap}px)`
  }
}

/** Calendar events are outlined, so they read as "already happening" rather than tasks to do. */
export const eventOutline = `1px dashed #3d3d3d`
