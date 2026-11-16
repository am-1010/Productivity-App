import type { CSSProperties } from 'react'

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
