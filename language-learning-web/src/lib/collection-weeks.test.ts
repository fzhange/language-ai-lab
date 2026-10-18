import { describe, expect, it } from 'vitest'

import { collectionWeekForDate, collectionWeeksInMonth, formatCollectionWeekRange, parseCollectionWeekKey, shiftCollectionMonth } from './collection-weeks'

describe('collection week periods', () => {
  it('uses Monday-to-Sunday calendar rows clipped to the month', () => {
    const weeks = collectionWeeksInMonth(2026, 10)
    expect(weeks.map((week) => [week.key, week.startsOn.getDate(), week.endsOn.getDate()])).toEqual([
      ['2026M10W1', 1, 4],
      ['2026M10W2', 5, 11],
      ['2026M10W3', 12, 18],
      ['2026M10W4', 19, 25],
      ['2026M10W5', 26, 31],
    ])
    expect(formatCollectionWeekRange(weeks[2])).toBe('10 月 12 日至 18 日')
  })

  it('supports months with six calendar rows and rejects impossible keys', () => {
    expect(collectionWeeksInMonth(2026, 8)).toHaveLength(6)
    expect(parseCollectionWeekKey('2026M8W6')?.endsOn.getDate()).toBe(31)
    expect(parseCollectionWeekKey('2026M10W6')).toBeNull()
    expect(parseCollectionWeekKey('2026M13W1')).toBeNull()
  })

  it('finds a date category and shifts across year boundaries', () => {
    expect(collectionWeekForDate(new Date(2026, 9, 15)).key).toBe('2026M10W3')
    expect(shiftCollectionMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
  })
})
