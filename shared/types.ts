// Общие типы площадки посуточной аренды: мини-приложение и сервер видят одно и то же.
// Даты — строки «ГГГГ-ММ-ДД» (без часовых поясов): ночь — это дата заезда, выезд — следующая дата.

export type PlaceType = "flat" | "studio" | "room" | "house";

export const PLACE_TYPES: { id: PlaceType; title: string }[] = [
  { id: "flat", title: "Квартира" },
  { id: "studio", title: "Студия" },
  { id: "room", title: "Комната" },
  { id: "house", title: "Дом" },
];

/**
 * draft — хозяин заполняет; pending — ждёт модератора; active — видно в поиске;
 * rejected — модератор вернул с причиной; paused — хозяин снял с показа; blocked — снято модератором
 */
/** deleted — хозяин удалил: никому не видно, но запись остаётся для истории броней и жалоб */
export type ListingStatus = "draft" | "pending" | "active" | "rejected" | "paused" | "blocked" | "deleted";

export interface Photo {
  /** ссылка на картинку MAX (i.oneme.ru) — показываем в приложении */
  url: string;
  /** токен вложения MAX — чтобы переслать фото модератору без повторной загрузки */
  token?: string;
  /** размер в пикселях (для фото, загруженных из приложения) — бот отмечает слишком маленькие */
  w?: number;
  h?: number;
}

export interface HouseRules {
  pets: boolean;
  smoking: boolean;
  kids: boolean;
  parties: boolean;
}

export interface Listing {
  id: string;
  ownerId: number;
  status: ListingStatus;
  /** почему модератор вернул или снял объявление */
  moderatorNote?: string;
  type: PlaceType;
  /** населённый пункт: Самара, Тольятти, … */
  locality: string;
  district: string;
  /** улица и дом — видно всем, чтобы гость понял, подходит ли место */
  address: string;
  /** квартира, подъезд, код домофона — гость видит только после подтверждения брони */
  flat?: string;
  rooms: number;
  area: number | null;
  floor: number | null;
  guests: number;
  beds: number;
  /** цена за ночь с воскресенья по четверг */
  priceWeekday: number;
  /** цена за ночь в пятницу и субботу */
  priceWeekend: number;
  minNights: number;
  /** залог при заселении, ₽ (0 — без залога) */
  deposit: number;
  checkIn: string;
  checkOut: string;
  rules: HouseRules;
  amenities: string[];
  description: string;
  photos: Photo[];
  /** даты, закрытые хозяином вручную (ночи) */
  closed: string[];
  /** бесплатная отмена: 0 — в любой момент до заезда, иначе не позже чем за N дней */
  cancelDays: number;
  /** модератор уже посмотрел текущую версию (объявление в поиске сразу, проверка — после) */
  checked?: boolean;
  /** текущую версию одобрил бот (автопроверка без замечаний) */
  botChecked?: boolean;
  /** почему бот отправил объявление модератору */
  botReasons?: string[];
  /** минимальная цена на момент последней проверки — резкое снижение после неё бот считает «приманкой» */
  approvedPrice?: number;
  /** сумма и число оценок гостей */
  rating?: { sum: number; count: number };
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
}

export const CANCEL_OPTIONS: { days: number; title: string }[] = [
  { days: 0, title: "Бесплатно до заезда" },
  { days: 1, title: "За 1 день" },
  { days: 3, title: "За 3 дня" },
  { days: 7, title: "За 7 дней" },
];

export interface Review {
  id: string;
  listingId: string;
  bookingId: string;
  guestId: number;
  guestName: string | null;
  stars: number;
  text: string;
  createdAt: number;
}

/** Команда площадки. owner — главный (Сергей): назначает модераторов; moderator — проверяет объявления и жалобы */
export interface StaffMember {
  id: number;
  role: "owner" | "moderator";
  addedBy: number | null;
  addedAt: number;
}

/**
 * Вход в отдельную админку через бота: страница показывает код, человек из команды отправляет его боту,
 * бот спрашивает «Это вы?» — после «Да» страница получает ключ входа
 */
export interface AdminLogin {
  id: string;
  /** sha256 секрета страницы, которая начала вход: забрать ключ может только она */
  secretHash: string;
  code: string;
  device: string;
  createdAt: number;
  expiresAt: number;
  state: "waiting" | "asked" | "approved" | "denied" | "used";
  /** кто из команды подтверждает */
  uid?: number;
}

/** Вход в админку на устройстве: действует, пока не нажали «Выйти» или человека не убрали из команды */
export interface AdminSession {
  uid: number;
  device: string;
  createdAt: number;
  lastSeenAt: number;
}

/** Запись журнала: кто из команды что сделал — чтобы при нескольких модераторах было видно, чьё решение */
export interface AuditEntry {
  at: number;
  by: number;
  action: string;
  target: string;
  note?: string;
}

/** Переписка гостя с хозяином по одному объявлению (одна на пару «гость + объявление») */
export interface ChatThread {
  id: string;
  listingId: string;
  guestId: number;
  ownerId: number;
  createdAt: number;
  updatedAt: number;
  /** сколько непрочитанных у каждой стороны */
  unreadGuest: number;
  unreadOwner: number;
  lastText: string;
  /** когда последний раз будили сторону уведомлением в чате — чтобы не засыпать сообщениями */
  notifiedGuestAt?: number;
  notifiedOwnerAt?: number;
  /**
   * Когда сторона удалила переписку у себя. Старые сообщения ей больше не показываются;
   * если собеседник напишет снова — переписка вернётся в список с новыми сообщениями
   */
  clearedGuestAt?: number;
  clearedOwnerAt?: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  from: "guest" | "owner";
  text: string;
  createdAt: number;
  /** метка из приложения: повторная отправка того же сообщения не создаёт дубль */
  clientKey?: string;
  /**
   * Автор удалил сообщение: обеим сторонам — «Сообщение удалено». Сам текст остаётся в базе
   * для разбора жалоб (мошенник не сотрёт «переведите на карту» после того, как гость пожаловался)
   */
  deletedAt?: number;
}

export interface Complaint {
  id: string;
  listingId: string;
  userId: number;
  reason: string;
  text: string;
  createdAt: number;
  resolved?: boolean;
  /** удалена командой как пустая/ложная — не считается против хозяина в автопроверке */
  dismissed?: boolean;
}

export const COMPLAINT_REASONS: { id: string; title: string }[] = [
  { id: "fake", title: "Квартиры нет или фото чужие" },
  { id: "prepay", title: "Просят предоплату на карту" },
  { id: "price", title: "Цена не та, что в объявлении" },
  { id: "rude", title: "Хозяин грубит или не отвечает" },
  { id: "other", title: "Другое" },
];

/**
 * requested — запрос, даты держатся за гостем, пока хозяин решает;
 * confirmed — хозяин подтвердил; declined — отказал; expired — не ответил вовремя;
 * cancelled — отменил гость или хозяин (после подтверждения)
 */
export type BookingStatus = "requested" | "confirmed" | "declined" | "expired" | "cancelled" | "noshow";

/** Эти брони занимают даты в календаре */
export const HOLDING: BookingStatus[] = ["requested", "confirmed"];

export interface Booking {
  id: string;
  listingId: string;
  ownerId: number;
  guestId: number;
  guestName: string | null;
  guestPhone: string;
  /** первая ночь */
  checkIn: string;
  /** дата выезда (ночью не считается) */
  checkOut: string;
  guests: number;
  nights: number;
  total: number;
  comment: string;
  status: BookingStatus;
  createdAt: number;
  /** до какого момента хозяин должен ответить на запрос */
  decideBy: number;
  decidedAt?: number;
  cancelledBy?: "guest" | "owner";
  /** напоминание за день до заезда уже отправлено */
  reminded?: boolean;
  /** после выезда бот попросил оценку */
  reviewAsked?: boolean;
  /** метка попытки из приложения: повтор той же отправки возвращает ту же бронь, а не ошибку */
  clientKey?: string;
  reviewed?: boolean;
  /** гость отменил позже срока бесплатной отмены */
  lateCancel?: boolean;
  /** убрана из списка у гостя / у хозяина (сама бронь остаётся — для споров и статистики) */
  hiddenGuest?: boolean;
  hiddenOwner?: boolean;
}

/** Заявка «хочу сдавать»: без одобрения модератора объявления размещать нельзя */
export interface HostApplication {
  name: string;
  city: string;
  about: string;
  at: number;
  note?: string;
}

export type HostStatus = "none" | "pending" | "approved" | "rejected";

/** Лимиты против ложных броней */
export const BOOKING_LIMITS = {
  /** одновременно ждущих ответа запросов у одного гостя */
  activeRequests: 3,
  /** насколько вперёд можно бронировать */
  daysAhead: 180,
  /** «не приехал» или поздняя отмена — после стольких бронировать больше нельзя */
  strikes: 2,
};

export interface User {
  id: number;
  name: string | null;
  phone: string | null;
  /** когда дал согласие на обработку данных (152-ФЗ) */
  consentAt: number | null;
  createdAt: number;
  /** ждём от хозяина фото в чат бота для этого объявления */
  photosFor?: string | null;
  /** заблокирован модератором (обман): ни искать, ни сдавать */
  blocked?: boolean;
  favorites?: string[];
  /** сдавать можно только после одобрения заявки */
  hostStatus?: HostStatus;
  hostApp?: HostApplication;
  /** «не приехал» и поздние отмены — для защиты хозяев от ложных броней */
  strikes?: number;
  /** номер пришёл из окна MAX «Поделиться номером» с верной подписью — не вписан руками */
  phoneVerified?: boolean;
}

/** Карточка в поиске: без адреса и без данных хозяина */
export interface ListingCard {
  id: string;
  type: PlaceType;
  title: string;
  locality: string;
  district: string;
  /** улица и дом */
  address: string;
  guests: number;
  rooms: number;
  area: number | null;
  priceFrom: number;
  photo: string | null;
  /** сумма за выбранные даты, если даты указаны */
  total: number | null;
  nights: number | null;
  /** средняя оценка (одна цифра после запятой) и сколько оценок */
  stars: number | null;
  reviews: number;
  createdAt: number;
}

/** Объявление для гостя: всё, кроме квартиры и контактов */
export type PublicListing = Omit<Listing, "flat" | "ownerId" | "closed" | "moderatorNote" | "checked" | "botChecked" | "botReasons" | "approvedPrice"> & {
  title: string;
  /** занятые ночи на ближайшие 120 дней */
  busy: string[];
  stars: number | null;
  reviewList: Pick<Review, "id" | "guestName" | "stars" | "text" | "createdAt">[];
  favorite: boolean;
};
