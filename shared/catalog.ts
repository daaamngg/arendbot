import { PLACE_TYPES, type Listing } from "./types.ts";

// Справочники анкеты: города области, районы, удобства. Площадка — Самара и Самарская область (ответ Сергея 10.11).

export const LOCALITIES = [
  "Самара",
  "Тольятти",
  "Сызрань",
  "Новокуйбышевск",
  "Жигулёвск",
  "Чапаевск",
  "Отрадный",
  "Кинель",
  "Похвистнево",
  "Октябрьск",
  "Нефтегорск",
  "Безенчук",
  "Красный Яр",
  "Ширяево",
];

/** Районы — только для больших городов; в остальных район пишется словами или не нужен */
export const DISTRICTS: Record<string, string[]> = {
  Самара: ["Ленинский", "Самарский", "Октябрьский", "Железнодорожный", "Советский", "Промышленный", "Кировский", "Красноглинский", "Куйбышевский"],
  Тольятти: ["Автозаводский", "Центральный", "Комсомольский"],
};

export const AMENITIES = [
  "Wi-Fi",
  "Кондиционер",
  "Стиральная машина",
  "Холодильник",
  "Плита",
  "Микроволновка",
  "Посуда",
  "Чайник",
  "Утюг",
  "Фен",
  "Телевизор",
  "Бельё и полотенца",
  "Парковка",
  "Лифт",
  "Балкон",
  "Детская кроватка",
  "Заселение без встречи",
];

/** «2-комн. квартира, 54 м²», «Студия, 28 м²», «Дом, 3 комнаты» */
export function listingTitle(l: Pick<Listing, "type" | "rooms" | "area">) {
  const area = l.area ? `, ${l.area} м²` : "";
  if (l.type === "flat") return `${l.rooms}-комн. квартира${area}`;
  if (l.type === "house") return `Дом, ${l.rooms} комн.${area}`;
  return `${PLACE_TYPES.find((t) => t.id === l.type)?.title ?? "Жильё"}${area}`;
}

/** Чего не хватает, чтобы отправить объявление на модерацию */
export function missingForSubmit(l: Listing): string[] {
  const m: string[] = [];
  if (!l.locality) m.push("город");
  if (!l.address.trim()) m.push("улица и дом");
  if (!(l.priceWeekday > 0) || !(l.priceWeekend > 0)) m.push("цена");
  if (!(l.guests > 0)) m.push("сколько гостей");
  // Описание необязательно: фото, цена и адрес говорят больше
  if (l.photos.length < 2) m.push("фото (минимум 2)");
  return m;
}

export const MAX_PHOTOS = 15;

/** Полный адрес для гостя после подтверждения: город, улица и дом, квартира */
export const fullAddress = (l: { locality: string; address: string; flat?: string }) => [l.locality, l.address, l.flat].filter((x) => x && x.trim()).join(", ");
