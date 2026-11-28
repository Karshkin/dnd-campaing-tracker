export const periods = [
  ["Hammer", 30], ["Midwinter", 1], ["Alturiak", 30], ["Ches", 30], ["Tarsakh", 30], ["Greengrass", 1],
  ["Mirtul", 30], ["Kythorn", 30], ["Flamerule", 30], ["Midsummer", 1], ["Shieldmeet", 0],
  ["Eleasis", 30], ["Eleint", 30], ["Highharvestide", 1], ["Marpenoth", 30], ["Uktar", 30],
  ["Feast of the Moon", 1], ["Nightal", 30],
];

export const periodsInYear = (year) => periods.map(([label, days]) => [label, label === "Shieldmeet" && year % 4 === 0 ? 1 : days]);
const yearStart = (year) => (year - 1) * 365 + Math.floor((year - 1) / 4);

export function toHarptosDay(year, period, day) {
  const months = periodsInYear(year);
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(day) || day < 1 || day > (months[period]?.[1] ?? 0)) {
    throw new RangeError("Fecha de Harptos inválida");
  }
  return yearStart(year) + months.slice(0, period).reduce((count, [, days]) => count + days, 0) + day - 1;
}

export function fromHarptosDay(ordinal) {
  let year = Math.floor(ordinal / 1461) * 4 + 1;
  while (yearStart(year + 1) <= ordinal) year++;
  let remaining = ordinal - yearStart(year);
  return periodsInYear(year).reduce((date, [label, days], period) => {
    if (date) return date;
    if (remaining < days) return { year, period, label, day: remaining + 1, festival: days === 1 };
    remaining -= days;
    return date;
  }, null);
}

export function formatHarptos(ordinal) {
  const { year, label, day, festival } = fromHarptosDay(ordinal);
  return `${festival ? "" : `${day} `}${label} · ${year} CV`;
}
