import type { Booking, Complaint, Listing, User } from "./types.ts";
import { hasContacts } from "./trust.ts";

// Проверка ботом — по правилам, без нейросетей. Ловим ТОЛЬКО грубые нарушения, то есть признаки обмана и
// явного нарушения правил площадки. Мелочи (капс, площадь, залог, смайлики) не трогаем: хозяин сдаёт как хочет.
//
// ОБЪЯВЛЕНИЯ — бот решает сам: нарушений нет — сразу в поиске с отметкой «проверено ботом».
// Есть — объявление ждёт модератора, он видит причину.
//
// ЗАЯВКИ «ХОЧУ СДАВАТЬ» — решает человек; бот только подсвечивает грубое (номер заблокированного и т. п.).

/** Просьбы заплатить мимо площадки — главный приём мошенников */
const STOP_WORDS = /предоплат|аванс|переведите|перевод на карту|скин(ь|уть)те? на карту|только по предоплате|бронь по предоплате|без посредников звоните|пишите в личку/i;
/** Мат в объявлении — нарушение правил */
const RUDE = /(?:^|[^а-яё])(?:бля|сук[аи]|хуй|пизд|ебан|ёб|нахуй|мудак|гандон)/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, " ").trim();
/** Служебные слова адреса — при сравнении не важны */
const ADDR_WORDS = new Set(["ул", "улица", "пр", "проспект", "д", "дом", "кв", "квартира", "корп", "корпус", "стр", "строение", "пер", "переулок", "ш", "шоссе", "г", "город", "пос", "посёлок", "поселок"]);
/**
 * Адрес для сравнения: «ул. Ленина, д. 12, кв 5» и «Ленина ул., 12, кв.5» — одно и то же.
 * Слова по алфавиту без служебных (\b в JavaScript не понимает русские буквы, поэтому через split)
 */
const addrKey = (l: Pick<Listing, "locality" | "address" | "flat">) =>
  norm(`${l.locality} ${l.address} ${l.flat ?? ""}`)
    .split(" ")
    .filter((w) => w && !ADDR_WORDS.has(w))
    .sort()
    .join(" ");

const LIVE: Listing["status"][] = ["active", "pending", "paused"];

export interface AutoCheckInput {
  listing: Listing;
  owner: User | undefined;
  /** все объявления площадки (для поиска чужих фото, текста и адреса) */
  all: Listing[];
  /** все жалобы */
  complaints: Complaint[];
  /** другие люди с тем же номером телефона, что у хозяина */
  phoneTwins?: User[];
  now: number;
}

/** Грубые нарушения, из-за которых объявление нужно показать модератору. Пусто — бот одобряет */
export function autoCheck({ listing: l, owner, all, complaints, phoneTwins = [], now }: AutoCheckInput): string[] {
  const r: string[] = [];
  const minPrice = Math.min(l.priceWeekday, l.priceWeekend);
  const others = all.filter((x) => x.ownerId !== l.ownerId && x.id !== l.id && x.status !== "draft");
  const mine = all.filter((x) => x.ownerId === l.ownerId && x.id !== l.id);

  // 1. Деньги или контакты мимо площадки
  if (STOP_WORDS.test(l.description)) r.push("просят предоплату или писать мимо площадки");
  if (hasContacts(l.description) || hasContacts(l.address) || hasContacts(l.flat ?? "")) r.push("контакты в тексте");

  // 2. Чужое жильё: фото, текст или сама квартира уже есть у другого хозяина — типичный фейк
  const myPhotos = new Set(l.photos.map((p) => p.url));
  if (others.some((x) => x.photos.some((p) => myPhotos.has(p.url)))) r.push("фото из чужого объявления");
  const text = norm(l.description);
  if (text.length >= 40 && others.some((x) => norm(x.description) === text)) r.push("описание скопировано из чужого объявления");
  const key = addrKey(l);
  if (l.flat && others.some((x) => LIVE.includes(x.status) && x.flat && addrKey(x) === key)) r.push("эту квартиру уже сдаёт другой хозяин");

  // 3. Цена-приманка: нереально дёшево или резко снизили сразу после одобрения
  if (minPrice > 0 && minPrice < 500) r.push("нереально низкая цена — похоже на приманку");
  if (l.approvedPrice && minPrice < l.approvedPrice * 0.5) r.push(`цену снизили больше чем вдвое после проверки (было от ${l.approvedPrice} ₽)`);

  // 4. Человек: номер заблокированного, жалобы на обман, спам объявлениями
  if (phoneTwins.some((u) => u.blocked)) r.push("номер хозяина был у заблокированного за нарушения");
  const myIds = new Set([l.id, ...mine.map((x) => x.id)]);
  const fraud = complaints.filter((c) => myIds.has(c.listingId) && !c.dismissed && (c.reason === "fake" || c.reason === "prepay"));
  if (fraud.length >= 2) r.push(`жалобы на обман или предоплату: ${fraud.length}`);
  if (mine.filter((x) => now - x.createdAt < 24 * 3600_000).length >= 10) r.push("больше 10 объявлений за сутки — похоже на спам");

  // 5. Мат
  if (RUDE.test(l.description)) r.push("мат в описании");

  void owner;
  return [...new Set(r)];
}

// --- Заявка «хочу сдавать»: подсказки модератору (только грубое) ------------------------------

export interface HostHints {
  /** грубое — посмотреть внимательно */
  flags: string[];
  /** что говорит в пользу */
  good: string[];
}

export function hostHints(input: { user: User; phoneTwins: User[]; asGuest: Booking[]; complaintsByUser: number; now: number }): HostHints {
  const { user: u, phoneTwins, asGuest, now } = input;
  const a = u.hostApp;
  const flags: string[] = [];
  const good: string[] = [];
  if (phoneTwins.some((x) => x.blocked)) flags.push("этот номер был у заблокированного за нарушения");
  if ((u.strikes ?? 0) >= 2) flags.push("как гость дважды не приехал или отменил в последний момент");
  if (a && (hasContacts(a.about) || STOP_WORDS.test(a.about))) flags.push("в «о себе» контакты или просьба о предоплате");
  if (a && RUDE.test(`${a.name} ${a.about}`)) flags.push("мат в заявке");
  const days = Math.floor((now - u.createdAt) / 86_400_000);
  if (days >= 7) good.push(`в боте ${days} дн.`);
  const stayed = asGuest.filter((b) => b.status === "confirmed" && b.reviewed).length;
  if (stayed) good.push(`жил как гость и оставил отзыв: ${stayed}`);
  return { flags, good };
}
