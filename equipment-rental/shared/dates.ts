// Даты — строками «ГГГГ-ММ-ДД» по Самаре (UTC+4). Аренда считается по дням: с первого по последний включительно.
const DAY = 86_400_000;
const RE = /^\d{4}-\d{2}-\d{2}$/;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const isDate = (s: unknown): s is string => typeof s === "string" && RE.test(s) && fromMs(toMs(s)) === s;
export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY);
export const todaySamara = (now = Date.now()) => fromMs(now + 4 * 3600_000);
/** сколько дней аренды: с from по to включительно */
export const daysCount = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY) + 1;
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const dayText = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
export const rangeText = (from: string, to: string) => (from === to ? dayText(from) : from.slice(0, 7) === to.slice(0, 7) ? `${Number(from.slice(8, 10))}–${dayText(to)}` : `${dayText(from)} – ${dayText(to)}`);
export const plural = (n: number, f: [string, string, string]) => {
  const a = n % 10;
  const b = n % 100;
  return a === 1 && b !== 11 ? f[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? f[1] : f[2];
};
export const daysText = (n: number) => `${n} ${plural(n, ["сутки", "суток", "суток"])}`;
export const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;
