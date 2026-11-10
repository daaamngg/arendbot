import { useEffect, useMemo, useState } from "react";
import { BedDouble, CalendarDays, ChevronDown, Flag, Heart, Home, MapPin, MessageCircle, Phone, SlidersHorizontal, Star, Users } from "lucide-react";
import { ThreadList } from "./Chat.tsx";
import { addDays, dayText, guestsText, guestsUpTo, nightsBetween, nightsFrom, nightsText, rangeText, rub, todaySamara } from "../../../shared/dates.ts";
import { CANCEL_OPTIONS, COMPLAINT_REASONS, type ListingCard, type PublicListing } from "../../../shared/types.ts";
import { api, errorText, type BookingView, type Me, type SearchQuery } from "../lib/api.ts";
import { haptic } from "../lib/max.ts";
import { Badge, H1, PhoneGate, Spinner, Stepper, Sticky, phoneText } from "../ui/ui.tsx";

// --- Поиск --------------------------------------------------------------------------

const QUICK_AMENITIES = ["Wi-Fi", "Парковка", "Кондиционер", "Стиральная машина"];
const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function Stars(props: { value: number; count: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 font-semibold text-ink">
      <Star size={13} className="fill-current text-[#c08a1e]" aria-hidden />
      {props.value.toFixed(1).replace(".", ",")}
      <span className="font-normal text-dim">({props.count})</span>
    </span>
  );
}

const SHORT_MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/**
 * Дата коротко («12 ноя»), а по нажатию — обычный календарь телефона: прозрачное поле лежит поверх текста.
 * Так строка не обрезается, как у стандартного поля «дд.мм.гггг»
 */
function DateField(props: { label: string; value?: string; min: string; onChange: (v: string | undefined) => void }) {
  const text = props.value ? `${Number(props.value.slice(8, 10))} ${SHORT_MONTHS[Number(props.value.slice(5, 7)) - 1]}` : props.label;
  return (
    <span className="relative min-w-0 flex-1">
      <span className={`block truncate py-1 text-[15px] ${props.value ? "font-semibold text-ink" : "text-dim"}`}>{text}</span>
      <input
        type="date"
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        min={props.min}
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value || undefined)}
        aria-label={props.label}
      />
    </span>
  );
}

const cancelText = (days: number = 0) =>
  days === 0 ? "Бесплатная отмена до заезда" : `Бесплатная отмена не позже чем ${CANCEL_OPTIONS.find((o) => o.days === days)?.title.toLowerCase() ?? `за ${days} дн.`} до заезда`;

export function SearchScreen(props: { me: Me; query: SearchQuery; onQuery: (q: SearchQuery) => void; onOpen: (id: string) => void }) {
  const q = props.query;
  const [cards, setCards] = useState<ListingCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todaySamara();

  useEffect(() => {
    let alive = true;
    setCards(null);
    setError(null);
    api
      .search(q)
      .then((r) => alive && setCards(r.cards))
      .catch(() => alive && setError("Не получилось загрузить. Проверьте интернет."));
    return () => {
      alive = false;
    };
  }, [q]);

  const set = (patch: Partial<SearchQuery>) => props.onQuery({ ...q, ...patch });
  const nights = q.checkIn && q.checkOut && q.checkOut > q.checkIn ? nightsBetween(q.checkIn, q.checkOut) : 0;
  const [filters, setFilters] = useState(false);
  const activeFilters = [q.priceMax, q.rooms, q.kids, q.pets].filter(Boolean).length + (q.amenities?.length ?? 0);

  return (
    <>
      {/* Компактный поиск: одна карточка строками «Где / Когда / Гостей», поля без своих рамок.
          Фильтры — отдельной кнопкой рядом, раскрываются под карточкой */}
      <h1 className="mb-3 text-[22px] leading-tight font-bold tracking-[-0.01em] text-ink">Квартиры посуточно</h1>
      <section className="card divide-y divide-line">
        <label className="flex items-center gap-3 px-4 py-2.5">
          <MapPin size={18} className="shrink-0 text-dim" aria-hidden />
          <span className="w-16 shrink-0 text-[13px] text-dim">Где</span>
          <select className="min-w-0 flex-1 bg-transparent py-1 text-[15px] font-semibold text-ink outline-none" value={q.locality ?? ""} onChange={(e) => set({ locality: e.target.value || undefined })} aria-label="Где">
            <option value="">Самара и область</option>
            {props.me.localities.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <CalendarDays size={18} className="shrink-0 text-dim" aria-hidden />
          <span className="w-16 shrink-0 text-[13px] text-dim">Когда</span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <DateField
              label="Заезд"
              value={q.checkIn}
              min={today}
              onChange={(checkIn) =>
                // Выезд по умолчанию — на следующий день, чтобы не выбирать дважды
                set({ checkIn, checkOut: checkIn && (!q.checkOut || q.checkOut <= checkIn) ? addDays(checkIn, 1) : q.checkOut })
              }
            />
            <span className="text-dim" aria-hidden>
              →
            </span>
            <DateField label="Выезд" value={q.checkOut} min={q.checkIn ? addDays(q.checkIn, 1) : today} onChange={(checkOut) => set({ checkOut })} />
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-1.5">
          <Users size={18} className="shrink-0 text-dim" aria-hidden />
          <span className="w-16 shrink-0 text-[13px] text-dim">Гостей</span>
          <div className="ml-auto">
            <Stepper label="гостей" value={q.guests ?? 1} min={1} max={12} onChange={(guests) => set({ guests })} />
          </div>
        </div>
      </section>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button className={`chip gap-1.5 ${activeFilters ? "!border-accent !text-accent" : ""}`} onClick={() => setFilters(!filters)} aria-expanded={filters}>
          <SlidersHorizontal size={15} /> Фильтры{activeFilters ? ` · ${activeFilters}` : ""}
        </button>
        <select className="rounded-lg bg-transparent text-[14px] font-semibold text-ink" value={q.sort ?? "price"} onChange={(e) => set({ sort: e.target.value as SearchQuery["sort"] })} aria-label="Сортировка">
          <option value="price">Сначала дешевле</option>
          <option value="rating">С высокой оценкой</option>
          <option value="new">Сначала новые</option>
        </select>
      </div>
      {filters && (
        <section className="mt-3 card space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <label className="text-[14px] text-ink" htmlFor="pmax">
              Цена за ночь до
            </label>
            <input id="pmax" className="field w-32 text-right" inputMode="numeric" placeholder="любая" value={q.priceMax ?? ""} onChange={(e) => set({ priceMax: Number(e.target.value.replace(/\D/g, "")) || undefined })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-ink">Комнат от</span>
            <Stepper label="комнат" value={q.rooms ?? 1} min={1} max={5} onChange={(rooms) => set({ rooms: rooms > 1 ? rooms : undefined })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="chip" aria-pressed={!!q.kids} onClick={() => set({ kids: !q.kids || undefined })}>
              С детьми
            </button>
            <button className="chip" aria-pressed={!!q.pets} onClick={() => set({ pets: !q.pets || undefined })}>
              С животными
            </button>
            {QUICK_AMENITIES.map((a) => (
              <button key={a} className="chip" aria-pressed={!!q.amenities?.includes(a)} onClick={() => set({ amenities: toggle(q.amenities ?? [], a) })}>
                {a}
              </button>
            ))}
          </div>
          {activeFilters > 0 && (
            <button className="text-[14px] font-semibold text-dim" onClick={() => set({ priceMax: undefined, rooms: undefined, kids: undefined, pets: undefined, amenities: undefined })}>
              Сбросить фильтры
            </button>
          )}
        </section>
      )}

      <div className="mt-4 mb-2 text-[13px] text-dim">{cards ? `Найдено: ${cards.length}${nights ? ` · цены за ${nightsText(nights)}` : ""}` : " "}</div>
      {error && <p className="text-bad">{error}</p>}
      {!cards && !error && <Spinner />}
      {cards?.length === 0 && (
        <div className="card p-5 text-center">
          <p className="font-semibold text-ink">Пока ничего не нашлось</p>
          <p className="mt-1 text-[14px] text-dim">Попробуйте другие даты или весь регион.</p>
        </div>
      )}
      {/* Карточка «сначала фото»: в посуточной аренде выбирают глазами. Цена — плашкой на фото, чтобы читалась сразу */}
      <ul className="space-y-4">
        {cards?.map((c) => (
          <li key={c.id}>
            <button className="block w-full text-left" onClick={() => props.onOpen(c.id)}>
              <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-surface-2">
                {c.photo ? (
                  <img src={c.photo} alt="" className="size-full object-cover" loading="lazy" />
                ) : (
                  <div className="grid size-full place-items-center text-dim">
                    <Home size={28} />
                  </div>
                )}
                <span className="absolute bottom-2.5 left-2.5 rounded-lg bg-surface px-2.5 py-1 text-[15px] font-bold text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)] tabular-nums">
                  {c.total != null ? rub(c.total) : `от ${rub(c.priceFrom)}`}
                  <span className="ml-1 text-[12px] font-medium text-dim">{c.total != null ? `за ${nightsText(c.nights!)}` : "ночь"}</span>
                </span>
              </div>
              <div className="mt-2 flex items-start justify-between gap-3 px-0.5">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">{c.title}</div>
                  <div className="truncate text-[13px] text-dim">
                    {[c.locality, c.district].filter(Boolean).join(", ")} · {guestsUpTo(c.guests)}
                  </div>
                </div>
                <div className="shrink-0 pt-0.5 text-[13px]">{c.stars != null ? <Stars value={c.stars} count={c.reviews} /> : <span className="text-dim">новое</span>}</div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- Жильё и бронь ------------------------------------------------------------------

const RULES: [keyof PublicListing["rules"], string, string][] = [
  ["kids", "Можно с детьми", "Без детей"],
  ["pets", "Можно с животными", "Без животных"],
  ["smoking", "Можно курить", "Не курить"],
  ["parties", "Можно вечеринки", "Без вечеринок"],
];

export function ListingScreen(props: { me: Me; id: string; query: SearchQuery; onPhone: (p: string) => void; onBooked: () => void; onChat: (listingId: string) => void }) {
  const [data, setData] = useState<{ listing: PublicListing; own: boolean } | null>(null);
  const [checkIn, setCheckIn] = useState(props.query.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(props.query.checkOut ?? "");
  const [guests, setGuests] = useState(props.query.guests ?? 1);
  const [comment, setComment] = useState("");
  const [stage, setStage] = useState<"view" | "confirm">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<BookingView | null>(null);
  const [fav, setFav] = useState(false);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    api.listing(props.id).then(
      (r) => {
        setData(r);
        setFav(r.listing.favorite);
      },
      () => setError("Объявление не найдено или снято."),
    );
  }, [props.id]);

  const l = data?.listing;
  const busySet = useMemo(() => new Set(l?.busy ?? []), [l]);
  // Цена считается здесь же, теми же правилами, что на сервере; сервер всё равно перепроверит
  const calc = useMemo(() => {
    if (!l || !checkIn || !checkOut || checkOut <= checkIn) return null;
    let total = 0;
    let taken = false;
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
      total += wd === 5 || wd === 6 ? l.priceWeekend : l.priceWeekday;
      if (busySet.has(d)) taken = true;
    }
    return { nights: nightsBetween(checkIn, checkOut), total, taken };
  }, [l, checkIn, checkOut, busySet]);

  if (error && !l) return <p className="text-bad">{error}</p>;
  if (!l) return <Spinner />;

  if (done) {
    return (
      <>
        <H1 sub={`Хозяин ответит до ${new Date(done.decideBy).toLocaleString("ru-RU", { timeZone: "Europe/Samara", hour: "2-digit", minute: "2-digit", day: "numeric", month: "long" })}. Ответ придёт в чат с ботом.`}>
          Запрос отправлен
        </H1>
        <section className="card p-4 text-[15px]">
          <div className="font-semibold text-ink">{l.title}</div>
          <div className="text-dim">
            {rangeText(done.checkIn, done.checkOut)}, {nightsText(done.nights)}, {guestsText(done.guests)}
          </div>
          <div className="mt-2 font-bold text-ink">{rub(done.total)}</div>
        </section>
        <p className="mt-3 text-[14px] text-dim">Адрес и телефон хозяина появятся, когда он подтвердит бронь. Оплата хозяину при заселении.</p>
        {/* Передумал сразу — отменить можно прямо здесь, хозяин получит сообщение и даты освободятся */}
        <button
          className="mt-4 text-[14px] font-semibold text-bad"
          onClick={async () => {
            if (!confirm("Отменить запрос?")) return;
            try {
              await api.cancel(done.id);
              props.onBooked();
            } catch (e) {
              alert(errorText(e));
            }
          }}
        >
          Отменить запрос
        </button>
        <Sticky>
          <button className="btn btn-main w-full" onClick={props.onBooked}>
            К моим броням
          </button>
        </Sticky>
      </>
    );
  }

  const book = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.book({ id: l.id, checkIn, checkOut, guests, comment: comment.trim() });
      haptic("success");
      setDone(r.booking);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const tooShort = calc && calc.nights < l.minNights;
  const canBook = calc && !calc.taken && !tooShort && guests <= l.guests && !data.own;

  return (
    <>
      {/* Фото во всю ширину, листаются пальцем; счётчик «2 / 7» — видно, сколько ещё */}
      <div className="relative -mx-4 -mt-4 mb-4">
        <div
          className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
          onScroll={(e) => setSlide(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
        >
          {l.photos.length ? (
            l.photos.map((p, i) => <img key={p.url} src={p.url} alt={i === 0 ? l.title : ""} className="aspect-[4/3] w-full shrink-0 snap-center object-cover" loading={i > 1 ? "lazy" : undefined} />)
          ) : (
            <div className="grid aspect-[16/10] w-full place-items-center bg-surface-2 text-dim">
              <Home size={32} />
            </div>
          )}
        </div>
        {l.photos.length > 1 && (
          <span className="absolute right-3 bottom-3 rounded-md bg-ink/75 px-2 py-0.5 text-[12px] font-semibold text-white tabular-nums">
            {slide + 1} / {l.photos.length}
          </span>
        )}
      </div>

      <div className="flex items-start gap-3">
        <h1 className="flex-1 text-[22px] leading-tight font-bold text-ink">{l.title}</h1>
        {!data.own && (
          <button
            className={`grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface ${fav ? "text-bad" : "text-dim"}`}
            aria-pressed={fav}
            aria-label={fav ? "Убрать из избранного" : "В избранное"}
            onClick={async () => {
              const r = await api.favorite(l.id, !fav).catch(() => null);
              if (r) {
                setFav(r.favorite);
                haptic("select");
              }
            }}
          >
            <Heart size={20} className={fav ? "fill-current" : ""} />
          </button>
        )}
      </div>
      {l.stars != null && (
        <div className="mt-1 text-[14px]">
          <Stars value={l.stars} count={l.reviewList.length} />
        </div>
      )}
      <div className="mt-1 flex items-center gap-1.5 text-[14px] text-dim">
        <MapPin size={15} /> {[l.locality, l.district].filter(Boolean).join(", ")}. Точный адрес после подтверждения
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-ink">
        <li className="flex items-center gap-1.5">
          <Users size={15} /> {guestsUpTo(l.guests)}
        </li>
        <li className="flex items-center gap-1.5">
          <BedDouble size={15} /> спальных мест: {l.beds}
        </li>
        {l.floor != null && <li>этаж {l.floor}</li>}
      </ul>

      {!data.own && (
        <button className="btn btn-soft mt-4 w-full" onClick={() => props.onChat(l.id)}>
          <MessageCircle size={18} /> Задать вопрос хозяину
        </button>
      )}

      <section className="mt-4 card divide-y divide-line text-[15px]">
        <div className="flex justify-between px-4 py-3">
          <span>Ночь в будни</span>
          <b className="text-ink tabular-nums">{rub(l.priceWeekday)}</b>
        </div>
        <div className="flex justify-between px-4 py-3">
          <span>Ночь в пятницу и субботу</span>
          <b className="text-ink tabular-nums">{rub(l.priceWeekend)}</b>
        </div>
        <div className="flex justify-between px-4 py-3 text-dim">
          <span>
            Заезд с {l.checkIn}, выезд до {l.checkOut}
          </span>
          <span>{nightsFrom(l.minNights)}</span>
        </div>
        {l.deposit > 0 && (
          <div className="flex justify-between px-4 py-3 text-dim">
            <span>Залог при заселении, вернут при выезде</span>
            <span className="tabular-nums">{rub(l.deposit)}</span>
          </div>
        )}
        <div className="px-4 py-3 text-dim">{cancelText(l.cancelDays)}</div>
      </section>

      {l.description && <p className="mt-4 whitespace-pre-line text-[15px]">{l.description}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {RULES.map(([k, yes, no]) => (
          <span key={k} className="chip">
            {l.rules[k] ? yes : no}
          </span>
        ))}
        {l.amenities.map((a) => (
          <span key={a} className="chip">
            {a}
          </span>
        ))}
      </div>

      {l.reviewList.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[17px] font-bold text-ink">Отзывы гостей</h2>
          <ul className="space-y-2">
            {l.reviewList.map((r) => (
              <li key={r.id} className="card p-3 text-[14px]">
                <div className="flex items-center justify-between">
                  <b className="text-ink">{r.guestName ?? "Гость"}</b>
                  <span className="text-[#c08a1e]" aria-label={`Оценка ${r.stars} из 5`}>
                    {"★".repeat(r.stars)}
                    <span className="text-line">{"★".repeat(5 - r.stars)}</span>
                  </span>
                </div>
                {r.text && <p className="mt-1">{r.text}</p>}
                <div className="mt-1 text-[12px] text-dim">{dayText(new Date(r.createdAt + 4 * 3600e3).toISOString().slice(0, 10))}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!data.own && <Complaint id={l.id} />}

      {data.own ? (
        <p className="mt-5 text-[14px] text-dim">Это ваше объявление, так его видят гости.</p>
      ) : (
        <section className="mt-6 card space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-ink">
            <CalendarDays size={18} /> Даты
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="field"
              type="date"
              min={todaySamara()}
              value={checkIn}
              onChange={(e) => {
                setCheckIn(e.target.value);
                if (e.target.value && (!checkOut || checkOut <= e.target.value)) setCheckOut(addDays(e.target.value, Math.max(1, l.minNights)));
              }}
              aria-label="Заезд"
            />
            <input className="field" type="date" min={checkIn ? addDays(checkIn, 1) : todaySamara()} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} aria-label="Выезд" />
          </div>
          <div className="flex items-center justify-between">
            <span className="label mb-0">Гостей</span>
            <Stepper label="гостей" value={guests} min={1} max={l.guests} onChange={setGuests} />
          </div>
          {calc?.taken && <p className="text-[14px] text-bad">На часть этих дат уже занято.</p>}
          {tooShort && <p className="text-[14px] text-bad">Минимум {nightsText(l.minNights)}.</p>}
          {stage === "confirm" && (
            <>
              {!props.me.user.phone || !props.me.user.consent ? (
                <PhoneGate why="Хозяин позвонит, когда подтвердит бронь. До подтверждения номер он не видит." onDone={props.onPhone} />
              ) : (
                <>
                  <label className="label" htmlFor="cm">
                    Комментарий хозяину <span className="font-normal text-dim">(необязательно)</span>
                  </label>
                  <textarea id="cm" className="field resize-none" rows={2} maxLength={500} placeholder="Во сколько приедете, кто с вами" value={comment} onChange={(e) => setComment(e.target.value)} />
                  <p className="flex items-center gap-1.5 text-[13px] text-dim">
                    <Phone size={14} /> Хозяин увидит номер {phoneText(props.me.user.phone)} только после подтверждения
                  </p>
                </>
              )}
            </>
          )}
          {error && <p className="text-[14px] text-bad">{error}</p>}
        </section>
      )}

      {!data.own && (
        <Sticky>
          {calc && !calc.taken && !tooShort && (
            <div className="mb-2 flex items-baseline justify-between text-[15px]">
              <span className="text-dim">
                {nightsText(calc.nights)}, {rangeText(checkIn, checkOut)}
              </span>
              <b className="text-[18px] text-ink tabular-nums">{rub(calc.total)}</b>
            </div>
          )}
          <button
            className="btn btn-main w-full"
            disabled={!canBook || busy || (stage === "confirm" && (!props.me.user.phone || !props.me.user.consent))}
            onClick={() => (stage === "view" ? setStage("confirm") : book())}
          >
            {stage === "view" ? (calc ? "Забронировать" : "Выберите даты") : busy ? "Отправляем…" : "Отправить запрос хозяину"}
          </button>
          {stage === "confirm" && <p className="mt-2 text-center text-[13px] text-dim">Оплата хозяину при заселении. Отменить можно в «Моих бронях».</p>}
        </Sticky>
      )}
    </>
  );
}

/** Оценка после проживания: звёзды и, по желанию, пара слов */
function ReviewForm(props: { bookingId: string; onDone: () => void }) {
  const [stars, setStars] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 rounded-lg bg-surface-2/60 p-3">
      <div className="text-[14px] font-semibold text-ink">Как прошло проживание?</div>
      <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Оценка">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={stars === n} aria-label={`${n} из 5`} className="grid size-10 place-items-center" onClick={() => setStars(n)}>
            <Star size={26} className={n <= stars ? "fill-current text-[#c08a1e]" : "text-dim"} />
          </button>
        ))}
      </div>
      {stars > 0 && (
        <>
          <textarea className="field mt-2 resize-none" rows={2} maxLength={1000} placeholder="Что понравилось, что нет (необязательно)" value={text} onChange={(e) => setText(e.target.value)} />
          <button
            className="btn btn-main mt-2 w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await api.review(props.bookingId, stars, text.trim()).catch(() => {});
              props.onDone();
            }}
          >
            Отправить оценку
          </button>
        </>
      )}
    </div>
  );
}

/** «Пожаловаться»: свёрнуто в ссылку, раскрывается в короткую форму. Уходит модератору в чат */
function Complaint(props: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(COMPLAINT_REASONS[0].id);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  if (state === "sent") return <p className="mt-6 text-[14px] text-dim">Спасибо, жалоба у модератора. Он проверит объявление.</p>;
  if (!open) {
    return (
      <button className="mt-6 flex items-center gap-1.5 text-[14px] text-dim" onClick={() => setOpen(true)}>
        <Flag size={15} /> Пожаловаться на объявление
      </button>
    );
  }
  return (
    <section className="mt-6 card space-y-3 p-4">
      <h2 className="font-bold text-ink">Что не так?</h2>
      <div className="flex flex-wrap gap-2">
        {COMPLAINT_REASONS.map((r) => (
          <button key={r.id} className="chip" aria-pressed={reason === r.id} onClick={() => setReason(r.id)}>
            {r.title}
          </button>
        ))}
      </div>
      <textarea className="field resize-none" rows={2} maxLength={500} placeholder="Подробности, если есть" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="text-[13px] text-dim">Никогда не переводите предоплату на карту до подтверждения брони в боте.</p>
      <button
        className="btn btn-line w-full"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          try {
            await api.complaint(props.id, reason, text.trim());
            setState("sent");
          } catch {
            setState("error");
          }
        }}
      >
        Отправить жалобу
      </button>
      {state === "error" && <p className="text-[14px] text-bad">Не получилось отправить, попробуйте ещё раз.</p>}
    </section>
  );
}

// --- Моё: избранное и брони ---------------------------------------------------------

type MineTab = "trips" | "chats" | "favs";

/**
 * «Моё»: три вкладки вместо длинной ленты — брони, сообщения, избранное. Брони делятся на предстоящие
 * и прошлые; у каждой маленькое фото слева, детали подтверждённой — в одной плашке
 */
export function TripsScreen(props: { onOpen: (id: string) => void; onChat: (threadId: string) => void; unread?: number }) {
  const [tab, setTab] = useState<MineTab>(props.unread ? "chats" : "trips");
  const [list, setList] = useState<BookingView[] | null>(null);
  const [favs, setFavs] = useState<ListingCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const load = () => api.myBookings().then((r) => setList(r.bookings), () => setError("Не получилось загрузить."));
  useEffect(() => {
    load();
    api.favorites().then((r) => setFavs(r.cards), () => {});
  }, []);

  const cancel = async (b: BookingView) => {
    if (!confirm(b.status === "confirmed" ? "Отменить подтверждённую бронь? Хозяин получит сообщение." : "Отменить запрос?")) return;
    try {
      await api.cancel(b.id);
      load();
    } catch (e) {
      alert(errorText(e));
    }
  };
  const hide = async (b: BookingView) => {
    if (!confirm("Убрать бронь из списка?")) return;
    try {
      await api.hideBooking(b.id);
      load();
    } catch (e) {
      alert(errorText(e));
    }
  };

  const today = todaySamara();
  const upcoming = (list ?? []).filter((b) => b.status === "requested" || (b.status === "confirmed" && b.checkOut > today));
  const past = (list ?? []).filter((b) => !upcoming.includes(b));
  const tabs: [MineTab, string, number][] = [
    ["trips", "Брони", upcoming.length],
    ["chats", "Сообщения", props.unread ?? 0],
    ["favs", "Избранное", favs.length],
  ];

  const row = (b: BookingView) => (
    <li key={b.id} className="p-3">
      <div className="flex gap-3">
        <button className="size-16 shrink-0 overflow-hidden rounded-lg bg-surface-2" onClick={() => props.onOpen(b.listingId)} aria-label={`Открыть: ${b.title}`}>
          {b.photo ? <img src={b.photo} alt="" className="size-full object-cover" loading="lazy" /> : <Home className="m-auto text-dim" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button className="min-w-0 truncate text-left font-semibold text-ink" onClick={() => props.onOpen(b.listingId)}>
              {b.title}
            </button>
            <b className="shrink-0 text-[15px] text-ink tabular-nums">{rub(b.total)}</b>
          </div>
          <div className="truncate text-[13px] text-dim">
            {b.locality} · {rangeText(b.checkIn, b.checkOut)} · {guestsText(b.guests)}
          </div>
          <div className="mt-1.5">
            <Badge booking={b.status} />
          </div>
        </div>
      </div>
      {b.status === "confirmed" && b.checkOut > today && (
        <div className="mt-3 space-y-0.5 rounded-lg bg-accent-soft px-3 py-2.5 text-[14px] text-ink">
          <div>{b.address}</div>
          <div className="text-dim">
            Заезд с {b.checkInTime}
            {b.deposit ? ` · залог ${rub(b.deposit)}` : ""}
          </div>
          {b.phone && (
            <a className="inline-flex items-center gap-1.5 pt-1 font-semibold text-accent" href={`tel:${b.phone}`}>
              <Phone size={15} /> Позвонить хозяину {phoneText(b.phone)}
            </a>
          )}
        </div>
      )}
      {b.status === "confirmed" && b.checkIn >= today && <p className="mt-2 text-[13px] text-dim">{cancelText(b.cancelDays)}</p>}
      {b.canReview && <ReviewForm bookingId={b.id} onDone={load} />}
      <div className="mt-2 flex gap-5 empty:hidden">
        {(b.status === "requested" || b.status === "confirmed") && b.checkIn >= today && (
          <button className="text-[14px] font-semibold text-bad" onClick={() => cancel(b)}>
            {b.status === "requested" ? "Отменить запрос" : "Отменить бронь"}
          </button>
        )}
        {/* Завершённую, отменённую или отклонённую бронь можно убрать из списка */}
        {!upcoming.includes(b) && (
          <button className="text-[14px] font-semibold text-dim" onClick={() => hide(b)}>
            Удалить из списка
          </button>
        )}
      </div>
    </li>
  );

  return (
    <>
      <h1 className="mb-3 text-[22px] leading-tight font-bold tracking-[-0.01em] text-ink">Моё</h1>
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
        {tabs.map(([id, title, n]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`h-9 rounded-lg text-[14px] font-semibold ${tab === id ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-dim"}`}
          >
            {title}
            {n > 0 && <span className={`ml-1 tabular-nums ${id === "chats" ? "text-bad" : "text-dim"}`}>{n}</span>}
          </button>
        ))}
      </div>

      {tab === "trips" &&
        (error ? (
          <p className="text-bad">{error}</p>
        ) : !list ? (
          <Spinner />
        ) : (
          <>
            {upcoming.length === 0 ? (
              <div className="card p-5 text-center text-[14px] text-dim">Предстоящих броней нет. Найдите жильё во вкладке «Поиск».</div>
            ) : (
              <ul className="card divide-y divide-line">{upcoming.map(row)}</ul>
            )}
            {past.length > 0 && (
              <>
                <button className="mt-5 mb-2 flex w-full items-center justify-between text-[15px] font-semibold text-ink" onClick={() => setShowPast(!showPast)} aria-expanded={showPast}>
                  Прошлые и отменённые · {past.length}
                  <ChevronDown size={18} className={showPast ? "rotate-180" : ""} />
                </button>
                {showPast && <ul className="card divide-y divide-line">{past.map(row)}</ul>}
              </>
            )}
          </>
        ))}

      {tab === "chats" && <ThreadList onOpen={props.onChat} bare />}

      {tab === "favs" &&
        (favs.length === 0 ? (
          <div className="card p-5 text-center text-[14px] text-dim">Нажмите на сердечко в объявлении, и оно появится здесь.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {favs.map((c) => (
              <button key={c.id} className="text-left" onClick={() => props.onOpen(c.id)}>
                <div className="aspect-[4/3] overflow-hidden rounded-xl bg-surface-2">{c.photo && <img src={c.photo} alt="" className="size-full object-cover" loading="lazy" />}</div>
                <div className="mt-1.5 truncate text-[14px] font-semibold text-ink">{c.title}</div>
                <div className="truncate text-[13px] text-dim">
                  {c.locality} · от {rub(c.priceFrom)}
                </div>
              </button>
            ))}
          </div>
        ))}
    </>
  );
}
