import type { Listing } from "./types.ts";

// Защита от обхода площадки и мошенников. Главная схема обмана в посуточной аренде — «напишите в WhatsApp,
// переведите предоплату на карту». Поэтому контакты в описании запрещены: телефон хозяина гость и так
// получит, когда бронь подтвердят.

const CONTACT_PATTERNS: RegExp[] = [
  // телефон: +7 927 123-45-67, 8(927)1234567, 89271234567
  /(?:\+7|(?<!\d)8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/,
  /(?<!\d)\d{10,11}(?!\d)/,
  // ссылки и мессенджеры
  /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:ru|com|me|su|рф|net|org)\b|t\.me|wa\.me|vk\.com/i,
  /(?<![\w.])@[a-z0-9_]{4,}/i,
  /what'?s ?app|ватс ?ап|вотс ?ап|вацап|телеграм|телега|telegram|вайбер|viber|авито|avito|циан|суточно\.ру/i,
  // прямые просьбы о переводе
  /предоплат\S* (?:на|по) (?:карт|номер|сбер|тиньк)|переведите|перевод на карту/i,
];

export const hasContacts = (s: string) => CONTACT_PATTERNS.some((p) => p.test(s));

/** В переписке контакты не запрещаем, а прячем: человек видит, что номер вырезан, и понимает почему */
export function maskContacts(s: string): { text: string; masked: boolean } {
  let masked = false;
  let text = s;
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
