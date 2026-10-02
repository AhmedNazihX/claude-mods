import type { Level } from './format'

type Rgb = readonly [number, number, number]

const SHADES: Readonly<Record<Level, { dark: Rgb; light: Rgb }>> = {
  green: { dark: [20, 83, 45], light: [134, 239, 172] },
  yellow: { dark: [133, 77, 14], light: [253, 224, 71] },
  red: { dark: [127, 29, 29], light: [252, 165, 165] },
}

const toHex = (rgb: Rgb): string =>
  `#${rgb.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`

const blend = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount

const mix = ([r1, g1, b1]: Rgb, [r2, g2, b2]: Rgb, amount: number): Rgb => [
  blend(r1, r2, amount),
  blend(g1, g2, amount),
  blend(b1, b2, amount),
]

/**
 * The colour of each tick from the start of the bar to its end: the level's
 * darkest shade at 0%, its lightest at 100%.
 */
export const tickShades = (level: Level, segments: number): string[] => {
  const { dark, light } = SHADES[level]
  const lastIndex = Math.max(segments - 1, 1)
  return Array.from({ length: segments }, (_, index) =>
    toHex(mix(dark, light, index / lastIndex)),
  )
}
