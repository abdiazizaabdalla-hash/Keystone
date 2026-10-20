// Suggested file numbers: the day the deal starts, as MM.DD.YYYY (for example 10.20.2026).
// A second deal started the same day becomes MM.DD.2.YYYY, a third MM.DD.3.YYYY, and so on.
// It is only a suggestion; people can type any file number they like.

const pad = (n: number) => String(n).padStart(2, '0');

/** Matches 10.20.2026 and 10.20.2.2026 (and the same without leading zeros). Group 3 is the same-day number. */
function sameDayPattern(month: number, day: number, year: number): RegExp {
  return new RegExp(`^0?${month}\\.0?${day}(?:\\.(\\d{1,3}))?\\.${year}$`);
}

export function suggestFileNumber(date: Date, existing: string[]): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  const pattern = sameDayPattern(month, day, year);

  let highest = 0; // 0 = nothing started today yet; the plain date counts as number 1
  for (const raw of existing) {
    const match = pattern.exec((raw || '').trim());
    if (!match) continue;
    highest = Math.max(highest, match[1] ? Number(match[1]) : 1);
  }

  const base = `${pad(month)}.${pad(day)}`;
  return highest === 0 ? `${base}.${year}` : `${base}.${highest + 1}.${year}`;
}
