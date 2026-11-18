import type { Listing } from "./types.ts";

// Защита от обхода площадки и мошенников. Главная схема обмана в посуточной аренде — «напишите в WhatsApp,
// переведите предоплату на карту». Поэтому контакты в описании запрещены: телефон хозяина гость и так
// получит, когда бронь подтвердят.

// Цифры, которые мошенники заменяют похожими буквами, чтобы номер не узнали: l и I вместо 1, O и о вместо 0
const D = "[0-9lIoOоО]";
/** В найденном «номере» должно быть хотя бы 8 настоящих цифр, иначе это обычное слово из похожих букв */
const enoughDigits = (m: string) => (m.match(/[0-9]/g) ?? []).length >= 8;
// Русские слова: границу слова \b JavaScript для кириллицы не видит, поэтому — через «не буква рядом»
const W = "(?<![а-яёa-z])";
const E = "(?![а-яёa-z])";

const CONTACT_PATTERNS: { re: RegExp; check?: (m: string) => boolean }[] = [
  // телефон: +7 927 123-45-67, 8(927)1234567, 89271234567, 8927l234567
  { re: new RegExp(String.raw`(?:\+7|(?<!\d)8)[\s\-()]*${D}{3}[\s\-()]*${D}{3}[\s\-]*${D}{2}[\s\-]*${D}{2}`, "i"), check: enoughDigits },
  { re: new RegExp(String.raw`(?<![0-9])${D}{10,11}(?![0-9])`, "i"), check: enoughDigits },
  // мобильный, набранный вразбивку: 8 9 2 7 1 2 3 4 5 6 7, 9-27-123-45-67
  { re: new RegExp(String.raw`(?<![0-9])(?:\+?7|8)?[\s\-()]*9(?:[\s\-()]*${D}){9}(?![0-9])`, "i"), check: enoughDigits },
  // адрес сайта «словами» или с пробелами: avito-oplata точка ru, t . me, wa . me, т.ме
  { re: /[a-zа-я0-9-]{2,}\s*(?:\.|точка|dot)\s*(?:ru|рф|com|me|su|net|org|site|online|pro|top|xyz)(?![а-яёa-z])/i },
  { re: new RegExp(String.raw`(?<![a-zа-яё])(?:t|т)\s*\.\s*(?:me|ме)${E}|${W}wa\s*\.\s*me${E}`, "i") },
  // почта, в том числе словами: ivan собака mail точка ru
  { re: /[a-z0-9._-]{2,}\s*(?:@|собака|\(at\)|\[at\])\s*[a-z0-9-]{2,}/i },
  // ссылки и мессенджеры
  { re: /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:ru|com|me|su|рф|net|org)\b|t\.me|wa\.me|vk\.com/i },
  { re: /(?<![\w.])@[a-z0-9_]{4,}/i },
  { re: /what'?s ?app|ватс ?ап|вотс ?ап|вацап|телеграм|телег[аиуе]|telegram|вайбер|viber|авито|avito|циан|суточно\.ру|вконтакте|инстаграм|instagram|insta(?![a-z])/i },
  // коротко: тг, tg, вк, vk, инст — только отдельным словом, чтобы не задеть обычные слова
  { re: new RegExp(`${W}(?:тг|tg|вк|vk|инст[аеу]?|inst)${E}`, "i") },
  // прямые просьбы о переводе
  { re: /предоплат\S* (?:на|по) (?:карт|номер|сбер|тиньк)|переведите|перевод на карту|скин\S* на карт\S*|по сбп|через сбп/i },
];

// Номер карты: 16–19 цифр слитно или группами (2202 2063 1234 5678) — главный путь «переведите предоплату».
// Скрываем, только если сходится контрольная цифра карты (алгоритм Луна): список цен «3500 4000 4500 5000» не тронем
const CARD = /(?<!\d)(?:\d[\s-]?){15,18}\d(?!\d)/g;
function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
const isCard = (m: string) => luhn(m.replace(/\D/g, ""));
const hasCard = (s: string) => (s.match(CARD) ?? []).some(isCard);

/** Цифры другим шрифтом (８９２７…) и похожие символы — к обычному виду, прежде чем искать контакты */
const plain = (s: string) => s.normalize("NFKC");

export const hasContacts = (raw: string) => {
  const s = plain(raw);
  return hasCard(s) || CONTACT_PATTERNS.some((p) => {
    const g = new RegExp(p.re.source, `${p.re.flags.replace("g", "")}g`);
    return [...s.matchAll(g)].some((m) => !p.check || p.check(m[0]));
  });
};

/** В переписке контакты не запрещаем, а прячем: человек видит, что номер вырезан, и понимает почему */
export function maskContacts(s: string): { text: string; masked: boolean } {
  let masked = false;
  let text = plain(s).replace(CARD, (m) => {
    if (!isCard(m)) return m;
    masked = true;
    return "[скрыто]";
  });
  for (const p of CONTACT_PATTERNS) {
    const g = new RegExp(p.re.source, `${p.re.flags.replace("g", "")}g`);
    text = text.replace(g, (m) => {
      if (p.check && !p.check(m)) return m;
      masked = true;
      return "[скрыто]";
    });
  }
  return { text, masked };
}

/**
 * Почему объявление нельзя показывать сразу, а нужно сначала проверить. Пусто — можно публиковать
 * (модератор посмотрит уже после)
 */
export function suspicion(l: Pick<Listing, "priceWeekday" | "priceWeekend" | "description" | "address" | "flat">): string[] {
  const r: string[] = [];
  const min = Math.min(l.priceWeekday, l.priceWeekend);
  const max = Math.max(l.priceWeekday, l.priceWeekend);
  // Слишком дёшево — классическая приманка мошенников; слишком дорого — скорее ошибка в цене
  if (min < 700) r.push("слишком низкая цена");
  if (max > 60_000) r.push("слишком высокая цена");
  if (max > min * 3) r.push("цена в выходные сильно отличается от будней");
  if (hasContacts(l.description) || hasContacts(l.address) || hasContacts(l.flat ?? "")) r.push("контакты в тексте");
  return r;
}

/**
 * Сообщение похоже на обман (по схемам с Авито и сайтов посуточной аренды): просьба оплатить «по ссылке»,
 * «безопасная сделка» вне площадки, коды из СМС, «служба безопасности», данные карты.
 * Такое сообщение не прячем, но получатель видит под ним предупреждение
 */
const RISKY =
  /код\S* (?:из|в|по) (?:смс|sms|сообщени)|смс[- ]?код|код подтвержд|продиктуй|назовите код|скажите код|безопасн\S* сделк|ссылк\S* (?:на|для) оплат|оплат\S* по ссылке|оплатить онлайн|форм\S* оплат|госуслуг|служб\S* безопасност|поддержк\S* (?:max|макс|площадк)|cvv|cvc|срок действия карты|данные (?:вашей )?карт|номер (?:вашей )?карты|залог (?:на|по) карт|предоплат|аванс|переведите|переводом на|возврат (?:денег|средств) (?:на|по)/i;
export const isRisky = (s: string) => RISKY.test(s);

/** Имя «под площадку» (Поддержка, Администрация, Служба безопасности) — так мошенник выдаёт себя за нас */
const FAKE_OFFICIAL = /поддержк|админ|модератор|служб[аыу]|безопасност|support|admin|посуточн|\bбот\b|оператор/i;
/**
 * Любой текст от людей: убираем управляющие символы, невидимые и «переворачивающие» строку символы
 * (ими подделывают ссылки и имена). Однострочные поля — ещё и без < > ` { } \, чтобы там не мог оказаться код.
 * На экране текст и так показывается как текст (React экранирует), это вторая линия защиты
 */
export function cleanText(v: unknown, max: number, oneLine = false): string {
  if (typeof v !== "string") return "";
  let s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "");
  if (oneLine) s = s.replace(/[\r\n\t]+/g, " ").replace(/[<>`{}\\]/g, "").replace(/ {2,}/g, " ");
  return s.trim().slice(0, max);
}

export const safeName = (name: string | null) => (name && (FAKE_OFFICIAL.test(name) || hasContacts(name)) ? null : name);
