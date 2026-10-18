export interface CollectionWeekPeriod {
  key: string
  year: number
  month: number
  index: number
  startsOn: Date
  endsOn: Date
}

const WEEK_KEY = /^(\d{4})M(1[0-2]|[1-9])W([1-6])$/

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function collectionWeeksInMonth(year: number, month: number): CollectionWeekPeriod[] {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) return []
  const first = new Date(year, month - 1, 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const lastDay = daysInMonth(year, month)
  const count = Math.ceil((mondayOffset + lastDay) / 7)
  return Array.from({ length: count }, (_, position) => {
    const index = position + 1
    const startsOnDay = Math.max(1, 1 - mondayOffset + position * 7)
    const endsOnDay = Math.min(lastDay, 7 - mondayOffset + position * 7)
    return {
      key: `${year}M${month}W${index}`,
      year,
      month,
      index,
      startsOn: new Date(year, month - 1, startsOnDay),
      endsOn: new Date(year, month - 1, endsOnDay),
    }
  })
}

export function parseCollectionWeekKey(key: string): CollectionWeekPeriod | null {
  const match = WEEK_KEY.exec(key)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const index = Number(match[3])
  return collectionWeeksInMonth(year, month).find((week) => week.index === index) ?? null
}

export function collectionWeekForDate(date: Date): CollectionWeekPeriod {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return collectionWeeksInMonth(year, month).find((week) => day >= week.startsOn.getDate() && day <= week.endsOn.getDate())!
}

export function formatCollectionWeekRange(week: CollectionWeekPeriod, compact = false): string {
  const start = week.startsOn.getDate()
  const end = week.endsOn.getDate()
  return compact
    ? `${String(week.month).padStart(2, '0')}/${String(start).padStart(2, '0')}–${String(week.month).padStart(2, '0')}/${String(end).padStart(2, '0')}`
    : `${week.month} 月 ${start} 日至 ${end} 日`
}

export function shiftCollectionMonth(year: number, month: number, amount: number): { year: number; month: number } {
  const date = new Date(year, month - 1 + amount, 1)
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

export function isCollectionWeekKey(value: string): boolean {
  return parseCollectionWeekKey(value) !== null
}
