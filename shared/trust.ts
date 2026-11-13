import type { Listing } from "./types.ts";

// Защита от обхода площадки и мошенников. Главная схема обмана в посуточной аренде — «напишите в WhatsApp,
// переведите предоплату на карту». Поэтому контакты в описании запрещены: телефон хозяина гость и так
// получит, когда бронь подтвердят.

const CONTACT_PATTERNS: RegExp[] = [
  // телефон: +7 927 123-45-67, 8(927)1234567, 89271234567
  /(?:\+7|(?<!\d)8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/,
  /(?<!\d)\d{10,11}(?!\d)/,
  // мобильный, набранный вразбивку: 8 9 2 7 1 2 3 4 5 6 7, 9-27-123-45-67
  /(?<!\d)(?:\+?7|8)?[\s\-()]*9(?:[\s\-()]*\d){9}(?!\d)/,
  // адрес сайта «словами» или с пробелами: avito-oplata точка ru, t . me, wa . me
  /[a-zа-я0-9-]{2,}\s*(?:\.|точка|dot)\s*(?:ru|рф|com|me|su|net|org|site|online|pro|top|xyz)\b/i,
  /\bt\s*\.\s*me\b|\bwa\s*\.\s*me\b|т\s*\.\s*ме\b/i,
  // ссылки и мессенджеры
  /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:ru|com|me|su|рф|net|org)\b|t\.me|wa\.me|vk\.com/i,
  /(?<![\w.])@[a-z0-9_]{4,}/i,
  /what'?s ?app|ватс ?ап|вотс ?ап|вацап|телеграм|телега|telegram|вайбер|viber|авито|avito|циан|суточно\.ру/i,
  // прямые просьбы о переводе
  /предоплат\S* (?:на|по) (?:карт|номер|сбер|тиньк)|переведите|перевод на карту|скин\S* на карт\S*|по сбп|через сбп/i,
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

export const hasContacts = (s: string) => hasCard(s) || CONTACT_PATTERNS.some((p) => p.test(s));

/** В переписке контакты не запрещаем, а прячем: человек видит, что номер вырезан, и понимает почему */
export function maskContacts(s: string): { text: string; masked: boolean } {
  let masked = false;
  let text = s.replace(CARD, (m) => {
    if (!isCard(m)) return m;
    masked = true;
    return "[скрыто]";
  });
  for (const p of CONTACT_PATTERNS) {
    const g = new RegExp(p.source, p.flags.includes("g") ? p.flags : `${p.flags}g`);
    text = text.replace(g, () => {
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
export const safeName = (name: string | null) => (name && FAKE_OFFICIAL.test(name) ? null : name);
