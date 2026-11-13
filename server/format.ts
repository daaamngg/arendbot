import { isRisky } from "../shared/trust.ts";
import { fullAddress, listingTitle } from "../shared/catalog.ts";
import { guestsText, nightsFrom, nightsText, rangeText, rub } from "../shared/dates.ts";
import { PLACE_TYPES, type Booking, type Complaint, type Listing, type User } from "../shared/types.ts";
import type { Button, OutMessage } from "./max-api.ts";

// Тексты сообщений бота. Коротко и по делу: даты, сумма, что сделать дальше — и кнопки.

export const phoneText = (p: string | null) => (p ? p.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7 $1 $2-$3-$4") : "нет номера");

const timeText = (ms: number) =>
  new Date(ms).toLocaleString("ru-RU", { timeZone: "Europe/Samara", hour: "2-digit", minute: "2-digit", day: "numeric", month: "long" });

const where = (l: Listing) => [l.locality, l.district].filter(Boolean).join(", ");

/** Хозяину: новый запрос на бронь */
export function requestToOwner(b: Booking, l: Listing): OutMessage {
  return {
    text: [
      "Запрос на бронь",
      `${listingTitle(l)}, ${where(l)}`,
      "",
      `${rangeText(b.checkIn, b.checkOut)}, ${nightsText(b.nights)}, ${guestsText(b.guests)}`,
      `Сумма: ${rub(b.total)}`,
      `Гость: ${b.guestName ?? "без имени"}`,
      ...(b.comment ? [`Комментарий: ${b.comment}`] : []),
      "",
      `Ответьте до ${timeText(b.decideBy)}, иначе запрос отменится сам. Телефон гостя придёт после подтверждения.`,
    ].join("\n"),
    buttons: [
      [
        { type: "callback", text: "Принять", payload: `bk:ok:${b.id}` },
        { type: "callback", text: "Отклонить", payload: `bk:no:${b.id}` },
      ],
    ],
  };
}

/** Тот же запрос после решения — кнопки убираем, пишем итог */
export function requestDecided(b: Booking, l: Listing): OutMessage {
  const result: Record<string, string> = {
    confirmed: `Вы приняли бронь. Телефон гостя: ${phoneText(b.guestPhone)}`,
    declined: "Вы отклонили запрос.",
    expired: "Запрос отменился: не было ответа вовремя.",
    cancelled: b.cancelledBy === "guest" ? "Гость отменил бронь. Даты снова свободны." : "Бронь отменена.",
  };
  return {
    text: [
      `Бронь ${rangeText(b.checkIn, b.checkOut)}`,
      `${listingTitle(l)}, ${where(l)}`,
      `${nightsText(b.nights)}, ${guestsText(b.guests)}, ${rub(b.total)}`,
      "",
      result[b.status] ?? "",
    ].join("\n"),
  };
}

/** Гостю: хозяин подтвердил — адрес и телефон хозяина */
export function confirmedToGuest(b: Booking, l: Listing, ownerPhone: string | null): OutMessage {
  return {
    text: [
      "Бронь подтверждена",
      `${listingTitle(l)}, ${rangeText(b.checkIn, b.checkOut)}`,
      "",
      `Адрес: ${fullAddress(l)}`,
      `Хозяин: ${phoneText(ownerPhone)}`,
      `Заезд с ${l.checkIn}, выезд до ${l.checkOut}`,
      `К оплате хозяину: ${rub(b.total)}${l.deposit ? `, плюс залог ${rub(l.deposit)} (вернут при выезде)` : ""}`,
      "",
      "Позвоните хозяину, чтобы договориться о заселении.",
    ].join("\n"),
  };
}

export function notConfirmedToGuest(b: Booking, l: Listing, appButton?: Button[][]): OutMessage {
  return {
    text: [
      b.status === "expired" ? "Хозяин не успел ответить, запрос отменился" : "Хозяин не смог принять бронь",
      `${listingTitle(l)}, ${rangeText(b.checkIn, b.checkOut)}`,
      "",
      "Посмотрите другие варианты на эти даты.",
    ].join("\n"),
    buttons: appButton,
  };
}

export function cancelledToOther(b: Booking, l: Listing, byGuest: boolean): OutMessage {
  return {
    text: [
      byGuest ? "Гость отменил бронь" : "Хозяин отменил бронь",
      `${listingTitle(l)}, ${rangeText(b.checkIn, b.checkOut)}`,
      byGuest ? `Даты снова свободны.${b.lateCancel ? " Гость отменил позже срока бесплатной отмены." : ""}` : "Посмотрите другие варианты, если ещё нужно жильё.",
    ].join("\n"),
  };
}

export function reminder(b: Booking, l: Listing, toGuest: boolean, otherPhone: string | null): OutMessage {
  return {
    text: [
      toGuest ? "Завтра заезд" : "Завтра заезжает гость",
      `${listingTitle(l)}, ${rangeText(b.checkIn, b.checkOut)}`,
      toGuest ? `Адрес: ${fullAddress(l)}. Заезд с ${l.checkIn}.` : `${guestsText(b.guests)}, ${rub(b.total)}.`,
      `${toGuest ? "Хозяин" : "Гость"}: ${phoneText(otherPhone)}`,
    ].join("\n"),
  };
}

export const REJECT_REASONS: Record<string, string> = {
  photos: "Нужны фото получше: светлые, без надписей, сама квартира.",
  data: "Не хватает данных или цена указана неверно.",
  fraud: "Объявление похоже на обман.",
  other: "Не подходит под правила площадки.",
};

/**
 * Модератору: объявление на проверку.
 * live — уже в поиске (проверка после публикации): кнопки «Всё хорошо» и «Скрыть»;
 * held — ждёт проверки до показа, причины подозрения в тексте
 */
export function toModerator(l: Listing, ownerPhone: string | null, again: boolean, live = false, held: string[] = [], open?: Button[][]): OutMessage {
  const m = moderatorBody(l, ownerPhone);
  const head = live
    ? again
      ? "Объявление изменено и уже в поиске, посмотрите"
      : "Новое объявление уже в поиске, посмотрите"
    : `${again ? "Объявление изменено" : "Новое объявление"}, ждёт проверки${held.length ? ` (${held.join(", ")})` : ""}`;
  return {
    ...m,
    text: `${head}\n${m.text}`,
    buttons: [
      ...(open ?? []),
      [{ type: "callback", text: live ? "Всё хорошо" : "Одобрить", payload: `mod:ok:${l.id}` }],
      // Причины отказа одним рядом
      [
        { type: "callback", text: "Фото", payload: `mod:no:${l.id}:photos` },
        { type: "callback", text: "Данные", payload: `mod:no:${l.id}:data` },
        { type: "callback", text: "Обман", payload: `mod:no:${l.id}:fraud` },
        { type: "callback", text: "Другое", payload: `mod:no:${l.id}:other` },
      ],
    ],
  };
}

export function complaintToAdmins(c: Complaint, l: Listing, reasonTitle: string, count: number, open?: Button[][]): OutMessage {
  return {
    text: [`Жалоба${count > 1 ? ` (${count})` : ""}: ${reasonTitle}`, `${listingTitle(l)}, ${where(l)}`, ...(c.text ? [`«${c.text}»`] : [])].join("\n"),
    buttons: [
      // Сначала посмотреть объявление, потом решить
      ...(open ?? []),
      [
        { type: "callback", text: "Скрыть", payload: `adm:hide:${l.id}:${c.id}` },
        { type: "callback", text: "Всё ок", payload: `adm:ok:${c.id}` },
        { type: "callback", text: "Бан", payload: `adm:ban:${l.ownerId}:${c.id}` },
      ],
    ],
  };
}

/** Сообщение в переписке — второй стороне. Ответить можно прямо здесь, функцией «Ответить» */
export function chatNotify(l: Listing, from: "guest" | "owner", text: string, guestName: string | null, open?: Button[][], unread = 1): OutMessage {
  const who =
    (from === "guest" ? `Сообщение от гостя${guestName ? ` ${guestName}` : ""}` : "Ответ хозяина") + (unread > 1 ? ` (непрочитанных: ${unread})` : "");
  return {
    text: [
      ...(isRisky(text) ? ["ОСТОРОЖНО, похоже на обман. Не переходите по ссылкам, не называйте коды из СМС и не переводите деньги до подтверждения брони в боте.", ""] : []),
      `${who} по «${listingTitle(l)}», ${l.locality}`,
      "",
      text,
      "",
      `Чтобы ответить, нажмите «Ответить» на этом сообщении.`,
    ].join("\n"),
    buttons: open,
  };
}

/** Модераторам: человек хочет сдавать жильё — кнопки «Принять» и «Отказать» прямо в чате */
export function hostAppToAdmins(u: User, hints?: { flags: string[]; good: string[] }): OutMessage {
  const a = u.hostApp!;
  return {
    text: [
      "Заявка на размещение",
      `${a.name}, ${phoneText(u.phone)}`,
      a.city,
      ...(a.about ? ["", a.about] : []),
      // Подсказки бота: что настораживает и что в пользу. Решение — за модератором
      ...(hints?.flags.length ? ["", `Бот: проверьте — ${hints.flags.join("; ")}`] : hints ? ["", "Бот: ничего подозрительного не нашёл"] : []),
      ...(hints?.good.length ? [`В пользу: ${hints.good.join("; ")}`] : []),
    ].join("\n"),
    buttons: [
      [
        { type: "callback", text: "Принять", payload: `ha:ok:${u.id}` },
        { type: "callback", text: "Отказать", payload: `ha:no:${u.id}` },
      ],
    ],
  };
}

export function hostDecisionToUser(approve: boolean, note: string, open?: Button[][]): OutMessage {
  return {
    text: approve
      ? "Заявка одобрена: теперь вы можете размещать объявления. Добавьте первое в приложении, вкладка «Сдать»."
      : `Заявка на размещение не одобрена.\n${note}\nЕсли что-то изменилось, можно подать заявку ещё раз.`,
    buttons: open,
  };
}

export function reviewAsk(b: Booking, l: Listing): OutMessage {
  return {
    text: [`Как прошло проживание?`, `${listingTitle(l)}, ${rangeText(b.checkIn, b.checkOut)}`, "", "Оцените жильё, это поможет другим гостям."].join("\n"),
    buttons: [[1, 2, 3, 4, 5].map((n) => ({ type: "callback" as const, text: "★".repeat(n), payload: `rv:${b.id}:${n}` }))],
  };
}

function moderatorBody(l: Listing, ownerPhone: string | null): OutMessage {
  const type = PLACE_TYPES.find((t) => t.id === l.type)?.title ?? "";
  const rules = [l.rules.pets && "можно с животными", l.rules.kids && "можно с детьми", l.rules.smoking && "можно курить", l.rules.parties && "можно вечеринки"].filter(Boolean);
  return {
    text: [
      `${listingTitle(l)} (${type.toLowerCase()})`,
      `${where(l)}, ${l.address}${l.flat ? `, ${l.flat}` : ""}`,
      `${guestsText(l.guests)}, спальных мест ${l.beds}${l.floor ? `, этаж ${l.floor}` : ""}`,
      `Будни ${rub(l.priceWeekday)}, выходные ${rub(l.priceWeekend)}, ${nightsFrom(l.minNights)}${l.deposit ? `, залог ${rub(l.deposit)}` : ""}`,
      `Правила: ${rules.length ? rules.join(", ") : "без животных, детей, курения и вечеринок"}`,
      `Хозяин: ${phoneText(ownerPhone)}`,
      "",
      l.description.slice(0, 700),
    ].join("\n"),
    images: l.photos.slice(0, 10).map((p) => (p.token ? { token: p.token } : { url: p.url })),
  };
}

export function moderatedToOwner(l: Listing, wasLive: boolean): OutMessage {
  return {
    text:
      l.status === "active"
        ? `Объявление «${listingTitle(l)}» прошло проверку и уже в поиске.`
        : [
            wasLive ? `Объявление «${listingTitle(l)}» скрыто из поиска модератором.` : `Объявление «${listingTitle(l)}» не прошло проверку.`,
            l.moderatorNote ?? "",
            "Поправьте и отправьте ещё раз.",
          ].join("\n"),
  };
}

export const publishedToOwner = (l: Listing): OutMessage => ({
  text: `Объявление «${listingTitle(l)}» опубликовано и уже в поиске. Запросы на бронь будут приходить сюда.`,
});

export const heldToOwner = (l: Listing): OutMessage => ({
  text: `Объявление «${listingTitle(l)}» отправлено на проверку. Обычно это занимает до суток, ответ придёт сюда.`,
});
