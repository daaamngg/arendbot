import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Phone, Store, Truck, X } from "lucide-react";
import { PHONE_HREF } from "../../../shared/catalog.ts";
import { addDays, daysCount, daysText, rangeText, rub, todaySamara } from "../../../shared/dates.ts";
import { PROMO, activeDiscount } from "../../../shared/promo.ts";
import type { Item } from "../../../shared/types.ts";
import { api, errorText, type Me } from "../lib/api.ts";
import { haptic } from "../lib/max.ts";
import { RangeCalendar } from "../ui/Calendar.tsx";
import { tell } from "../ui/dialog.tsx";
import { ItemPicture, PhoneGate, Spinner, Step } from "../ui/ui.tsx";

/** Оборудование: описание, свободные дни, доставка или самовывоз, сумма и заявка владельцу */
export function ItemScreen(props: { id: string; initialDays?: number; me: Me; onPhone: (p: string) => void; onBooked: () => void; onSwitch: (id: string) => void }) {
  const [data, setData] = useState<{ item: Item; busy: string[]; delivery: number } | null>(null);
  const [from, setFrom] = useState<string | undefined>(() => props.initialDays ? todaySamara() : undefined);
  const [to, setTo] = useState<string | undefined>(() => props.initialDays ? addDays(todaySamara(), props.initialDays - 1) : undefined);
  const [delivery, setDelivery] = useState(true);
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todaySamara();
  const [others, setOthers] = useState<Item[]>([]);
  const curRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    api.item(props.id).then(setData, (e) => setError(errorText(e)));
    api.items().then((r) => setOthers(r.items), () => {});
  }, [props.id]);
  // Текущее оборудование в ленте — по центру, чтобы соседние было видно с обеих сторон
  useEffect(() => {
    curRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [others.length, data]);
  const busySet = useMemo(() => new Set(data?.busy ?? []), [data]);
  if (!data) return error ? <p className="text-bad">{error}</p> : <Spinner />;
  const { item } = data;
  const days = from && to ? daysCount(from, to) : 0;
  const deliveryCost = delivery ? data.delivery : 0;
  // Та же проверка акции, что на сервере: подарок открыт и не сгорел, первая аренда, от minDays суток
  const discount = activeDiscount(props.me.promoAt, props.me.promoUsed, props.me.spinPercent, props.me.spinExpiresAt, Date.now(), days);
  const total = item.priceDay != null && days ? Math.round((item.priceDay * days * (100 - discount)) / 100) + deliveryCost : null;
  const addressOk = !delivery || address.trim().length >= 5;
  // Чего не хватает до заявки — подсказка внизу вместо немой серой кнопки
  const need = !days ? "Выберите дни" : !addressOk ? "Укажите адрес доставки" : !props.me.user.phone ? "Оставьте номер для связи" : null;
  const canSend = !need && !busy;

  const send = async () => {
    if (!from || !to) return;
    setBusy(true);
    setError(null);
    try {
      await api.book({ itemId: item.id, from, to, delivery, address, comment });
      haptic("success");
      await tell("Заявка отправлена", "Владелец ответит в чате с ботом. Если срочно, позвоните.");
      props.onBooked();
    } catch (e) {
      setError(errorText(e));
      // Дни могли занять, пока выбирали, — обновим календарь
      api.item(props.id).then(setData, () => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Фото во всю ширину, низ плавно уходит в белый фон (без шва под стеклом); на него наезжает стеклянная карточка с названием и ценой — как шапка каталога */}
      <div className="relative -mx-4 -mt-4">
        <ItemPicture item={item} className="block aspect-[4/3] w-full" size={64} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-white via-white/60 to-transparent" aria-hidden />
      </div>
      <div className="glass glass-strong relative -mt-12 overflow-hidden rounded-3xl p-4">
        <h1 className="glass-title font-display text-[25px] leading-tight font-bold">{item.title}</h1>
        <p className="mt-1 text-[14px] text-dim">{item.short}</p>
        <div className="mt-3 flex items-center gap-2">
          <b className="rounded-full bg-hot px-3.5 py-1.5 text-[15px] text-hot-ink tabular-nums">{item.priceDay != null ? rub(item.priceDay) : "Цена по звонку"}</b>
          {item.priceDay != null && <span className="text-[14px] text-dim">в сутки</span>}
        </div>
        <span className="glass-shine" aria-hidden />
      </div>

      {/* Переключатель: другое оборудование лентой, текущее выделено и сразу в центре */}
      {others.length > 1 && (
        <section className="mt-4">
          <h2 className="mb-2 text-[15px] font-bold text-ink">Другое оборудование</h2>
          <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {others.map((i) => {
              const cur = i.id === item.id;
              return (
                <button
                  key={i.id}
                  ref={cur ? curRef : undefined}
                  aria-current={cur ? "true" : undefined}
                  onClick={() => !cur && props.onSwitch(i.id)}
                  className={`flex shrink-0 snap-start items-center gap-2 rounded-2xl border p-1.5 pr-3.5 text-left transition-colors ${cur ? "border-coffee bg-coffee-soft" : "border-line bg-surface active:bg-surface-2"}`}
                >
                  <ItemPicture item={i} small className="size-11 rounded-xl" size={20} />
                  <span className={`line-clamp-2 w-[132px] text-[12px] leading-tight font-semibold ${cur ? "text-coffee" : "text-ink"}`}>{i.title}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <ul className="card mt-4 space-y-2 p-4 text-[15px]">
        {item.specs.map((s) => (
          <li key={s} className="flex gap-2.5">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-hot text-hot-ink">
              <Check size={13} strokeWidth={3} aria-hidden />
            </span>
            {s}
          </li>
        ))}
      </ul>

      <section className="card mt-4 p-4">
        <Step n={1} title="Дни аренды" done={days > 0} hint="Нажмите первый и последний день. Зачёркнутые заняты" />
        <RangeCalendar
          today={today}
          busy={busySet}
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
        />
        {days > 0 && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-coffee-soft py-2 pr-1.5 pl-3 text-[14px] text-coffee">
            <span className="flex min-w-0 items-center gap-2 font-semibold">
              <CalendarDays size={17} className="shrink-0" aria-hidden />
              <span className="truncate">
                {rangeText(from!, to!)}, {daysText(days)}
              </span>
            </span>
            <button
              className="grid size-8 shrink-0 place-items-center rounded-full text-coffee active:bg-white/60"
              onClick={() => {
                setFrom(undefined);
                setTo(undefined);
              }}
              aria-label="Сбросить дни"
            >
              <X size={17} />
            </button>
          </div>
        )}
      </section>

      <section className="card mt-3 p-4">
        <Step n={2} title="Как получить" done={days > 0 && addressOk} />
        {/* Переключатель: значок слева, название и пояснение в две строки — на узком экране ничего не переносится */}
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1" role="group" aria-label="Как получить оборудование">
          {(
            [
              [true, Truck, "Доставка", `${rub(data.delivery)} по городу`],
              [false, Store, "Самовывоз", "заберёте сами"],
            ] as const
          ).map(([v, Icon, title, hint]) => {
            const on = delivery === v;
            return (
              <button
                key={title}
                aria-pressed={on}
                onClick={() => setDelivery(v)}
                className={`flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${on ? "bg-surface text-ink shadow-[0_1px_3px_rgb(74_52_36/0.18)]" : "text-dim"}`}
              >
                <Icon size={20} className={`shrink-0 ${on ? "text-coffee" : ""}`} aria-hidden />
                <span className="min-w-0 leading-tight">
                  <span className="block text-[14px] font-semibold whitespace-nowrap">{title}</span>
                  <span className="block truncate text-[12px] opacity-80">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        {delivery && <input className="field mt-3" placeholder="Адрес доставки по Самаре" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Адрес доставки" />}
        <textarea className="field mt-3 resize-none" rows={2} maxLength={500} placeholder="Комментарий, если нужно" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Комментарий" />
      </section>

      {!props.me.user.phone && (
        <div className="mt-3">
          <PhoneGate onDone={props.onPhone} step={3} />
        </div>
      )}

      {/* Итог и кнопки — прижаты к низу экрана */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-auto border-t border-line bg-bg px-4 pt-3 pb-[max(14px,env(safe-area-inset-bottom))]">
        <div className="mb-2 flex items-baseline justify-between text-[14px]">
          <span className={need ? "font-medium text-coffee" : "text-dim"}>
            {need ?? `${daysText(days)}${delivery ? " + доставка" : ""}`}
            {discount > 0 && <b className="ml-1.5 rounded-full bg-hot px-2 py-0.5 text-[12px] text-hot-ink">−{discount}%</b>}
          </span>
          <b className="text-[17px] text-ink tabular-nums">{total != null ? rub(total) : days ? "цена по звонку" : ""}</b>
        </div>
        {error && <p className="mb-2 text-[14px] text-bad">{error}</p>}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button className="btn btn-main" disabled={!canSend} onClick={send}>
            Отправить заявку
          </button>
          <a className="btn btn-line px-4" href={PHONE_HREF} aria-label="Позвонить">
            <Phone size={19} />
          </a>
        </div>
      </div>
    </>
  );
}
