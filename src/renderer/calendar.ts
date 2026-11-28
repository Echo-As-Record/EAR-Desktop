import type { DayRange } from '../shared/ear.js'

export function localDay(date: Date, offset = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset)
}

export function monday(date: Date): Date {
  return localDay(date, -((date.getDay() + 6) % 7))
}

export function dayRange(date: Date): DayRange {
  return {
    start: localDay(date).toISOString().replace('.000Z', 'Z'),
    end: localDay(date, 1).toISOString().replace('.000Z', 'Z'),
  }
}
