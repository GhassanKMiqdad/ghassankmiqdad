export type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
};

export type CalendarMonth = {
  key: string;
  start: string;
  end: string;
  previous: string;
  next: string;
  cells: CalendarCell[];
};

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function shiftMonth(year: number, monthIndex: number, offset: number): string {
  const date = new Date(Date.UTC(year, monthIndex + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Builds a Monday/Sunday-neutral 7-column month grid using UTC calendar dates. */
export function buildCalendarMonth(monthValue: unknown, today: string): CalendarMonth {
  const fallback = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const candidate = typeof monthValue === "string" ? monthValue : "";
  const match = MONTH_PATTERN.exec(candidate);
  const candidateYear = match ? Number(match[1]) : 0;
  const key = match && candidateYear >= 2000 && candidateYear <= 2100 ? candidate : fallback;
  const [year, month] = key.split("-").map(Number) as [number, number];
  const monthIndex = month - 1;
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const end = `${key}-${String(daysInMonth).padStart(2, "0")}`;
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(Date.UTC(year, monthIndex, index - firstWeekday + 1));
    const dateKey = date.toISOString().slice(0, 10);
    return {
      date: dateKey,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === monthIndex,
    };
  });

  return {
    key,
    start: `${key}-01`,
    end,
    previous: shiftMonth(year, monthIndex, -1),
    next: shiftMonth(year, monthIndex, 1),
    cells,
  };
}
