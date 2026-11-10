import { HOLDING, type Booking, type Listing } from "./types.ts";

// Даты и деньги брони. Всё на строках «ГГГГ-ММ-ДД» в UTC — так 1 ноября не превратится в 31 октября
// из-за часового пояса телефона.

const DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isDate = (s: unknown): s is string => typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY);

/** Сегодня по Самаре (UTC+4) — «прошлые» даты считаем по местному времени */
export const todaySamara = (now = Date.now()) => fromMs(now + 4 * 3600_000);

export const nightsBetween = (checkIn: string, checkOut: string) => Math.round((toMs(checkOut) - toMs(checkIn)) / DAY);

/** Все ночи брони: от заезда включительно до выезда не включительно */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Пятница и суббота — ночи по цене выходного дня */
export const isWeekendNight = (d: string) => {
  const wd = new Date(toMs(d)).getUTCDay();
  return wd === 5 || wd === 6;
};

export const MAX_NIGHTS = 30;

export function price(l: Pick<Listing, "priceWeekday" | "priceWeekend">, checkIn: string, checkOut: string) {
  const nights = nightsOf(checkIn, checkOut);
  const total = nights.reduce((s, d) => s + (isWeekendNight(d) ? l.priceWeekend : l.priceWeekday), 0);
  return { nights: nights.length, total };
}

/** Занятые ночи объявления: закрытые хозяином + брони, которые держат даты */
export function busyNights(l: Pick<Listing, "closed">, bookings: Booking[]): Set<string> {
  const busy = new Set(l.closed);
  for (const b of bookings) if (HOLDING.includes(b.status)) for (const d of nightsOf(b.checkIn, b.checkOut)) busy.add(d);
  return busy;
}

export type RangeProblem = "bad_dates" | "past" | "too_far" | "too_short" | "too_long" | "busy";

/** Бронировать можно не дальше чем на полгода вперёд — длинные «заглушки» на даты не нужны */
export const DAYS_AHEAD = 180;

/** Можно ли забронировать эти даты. null — можно */
export function checkRange(
  l: Pick<Listing, "closed" | "minNights">,
  bookings: Booking[],
  checkIn: string,
  checkOut: string,
  now = Date.now(),
): RangeProblem | null {
  if (!isDate(checkIn) || !isDate(checkOut) || checkOut <= checkIn) return "bad_dates";
  if (checkIn < todaySamara(now)) return "past";
  if (checkIn > addDays(todaySamara(now), DAYS_AHEAD)) return "too_far";
  const n = nightsBetween(checkIn, checkOut);
  if (n < Math.max(1, l.minNights)) return "too_short";
  if (n > MAX_NIGHTS) return "too_long";
  const busy = busyNights(l, bookings);
  return nightsOf(checkIn, checkOut).some((d) => busy.has(d)) ? "busy" : null;
}

export const RANGE_TEXT: Record<RangeProblem, string> = {
  bad_dates: "Проверьте даты: выезд должен быть позже заезда.",
  past: "Эта дата уже прошла.",
  too_far: `Бронировать можно не дальше чем на ${DAYS_AHEAD} дней вперёд.`,
  too_short: "Слишком мало ночей для этого жилья.",
  too_long: `Посуточно можно снять не больше чем на ${MAX_NIGHTS} ночей.`,
  busy: "На эти даты уже занято. Выберите другие.",
};

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «12 ноября» */
export const dayText = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** «12–14 ноября» или «30 ноября – 2 декабря» */
export function rangeText(checkIn: string, checkOut: string) {
  if (checkIn.slice(0, 7) === checkOut.slice(0, 7)) return `${Number(checkIn.slice(8, 10))}–${dayText(checkOut)}`;
  return `${dayText(checkIn)} – ${dayText(checkOut)}`;
}

export const plural = (n: number, forms: [string, string, string]) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return forms[a > 10 && a < 20 ? 2 : b > 1 && b < 5 ? 1 : b === 1 ? 0 : 2];
};

export const nightsText = (n: number) => `${n} ${plural(n, ["ночь", "ночи", "ночей"])}`;
export const guestsText = (n: number) => `${n} ${plural(n, ["гость", "гостя", "гостей"])}`;
/** «от 1 ночи», «от 2 ночей» */
export const nightsFrom = (n: number) => `от ${n} ${plural(n, ["ночи", "ночей", "ночей"])}`;
/** «до 1 гостя», «до 3 гостей» — после «до» другой падеж */
export const guestsUpTo = (n: number) => `до ${n} ${plural(n, ["гостя", "гостей", "гостей"])}`;
// Неразрывный пробел перед ₽: сумма не разрывается на две строки
export const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;
