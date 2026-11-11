import type { Complaint, Listing, User } from "./types.ts";
import { suspicion } from "./trust.ts";

// Автопроверка объявления ботом — по правилам, без нейросетей: одинаково и предсказуемо.
// Всё чисто — объявление сразу в поиске с отметкой «проверено ботом», модератору смотреть не нужно.
// Есть хоть одна причина — объявление ждёт модератора, а он видит список причин.

/** Слова, с которых обычно начинается обман в посуточной аренде */
const STOP_WORDS = /предоплат|аванс|переведите|перевод на карту|скин(ь|уть)те? на карту|только по предоплате|бронь по предоплате|без документов|документы не нужны|срочно сдам|гарантия 100/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, " ").trim();

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface AutoCheckInput {
  listing: Listing;
  owner: User | undefined;
  /** все объявления площадки (для сравнения цены и поиска копий) */
  all: Listing[];
  /** все жалобы (смотрим жалобы на другие объявления этого хозяина) */
  complaints: Complaint[];
  now: number;
}

/** Причины, по которым объявление нужно показать модератору. Пусто — бот одобряет */
export function autoCheck({ listing: l, owner, all, complaints, now }: AutoCheckInput): string[] {
  const r = [...suspicion(l)];

  // --- объявление
  if (!/\d/.test(l.address)) r.push("в адресе нет номера дома");
  if (STOP_WORDS.test(l.description)) r.push("в описании просят предоплату или подозрительные слова");
  if (new Set(l.photos.map((p) => p.url)).size < l.photos.length) r.push("одинаковые фото");

  // Цена против похожих: тот же город и тип жилья, столько же комнат. Нужно хотя бы 3 для сравнения
  const similar = all.filter((x) => x.id !== l.id && x.status === "active" && x.locality === l.locality && x.type === l.type && x.rooms === l.rooms);
  if (similar.length >= 3) {
    const med = median(similar.map((x) => Math.min(x.priceWeekday, x.priceWeekend)));
    const mine = Math.min(l.priceWeekday, l.priceWeekend);
    if (mine < med * 0.5) r.push(`цена намного ниже похожих (обычно около ${Math.round(med)} ₽)`);
    else if (mine > med * 3) r.push(`цена намного выше похожих (обычно около ${Math.round(med)} ₽)`);
  }

  // Текст или фото взяты из чужого объявления — частый признак фейка
  const others = all.filter((x) => x.ownerId !== l.ownerId && x.status !== "draft");
  const text = norm(l.description);
  if (text.length >= 60 && others.some((x) => norm(x.description) === text)) r.push("описание совпадает с чужим объявлением");
  const myPhotos = new Set(l.photos.map((p) => p.url));
  if (others.some((x) => x.photos.some((p) => myPhotos.has(p.url)))) r.push("фото из чужого объявления");

  // --- хозяин
  if (!owner?.phone) r.push("у хозяина нет номера");
  // Возраст аккаунта не проверяем: сдавать может только тот, чью заявку уже одобрил модератор
  const mine = all.filter((x) => x.ownerId === l.ownerId);
  // У хозяина может быть несколько квартир, но 6 и больше объявлений за сутки — уже похоже на спам
  if (mine.filter((x) => x.id !== l.id && now - x.createdAt < 24 * 3600_000).length >= 5) r.push("много объявлений за сутки");
  const myIds = new Set(mine.map((x) => x.id));
  const against = complaints.filter((c) => myIds.has(c.listingId));
  if (against.length) r.push(`на объявления хозяина были жалобы: ${against.length}`);

  return r;
}
