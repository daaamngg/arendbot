import { useEffect, useRef, useState } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { CalendarDays, Pencil, Phone } from "lucide-react";
import { daysText, rangeText, rub, todaySamara } from "../../../shared/dates.ts";
import type { Item } from "../../../shared/types.ts";
import { api, errorText, type BookingView } from "../lib/api.ts";
import { useLive } from "../lib/live.ts";
import { MonthGrid } from "../ui/Calendar.tsx";
import { ask, askText, tell } from "../ui/dialog.tsx";
import { ItemPicture, Spinner, phoneText } from "../ui/ui.tsx";

/** Управление (для владельца): заявки с «Принять / Отклонить», ближайшие аренды, цены и календарь техники */
export function OwnerScreen(props: { onCalendar: (item: Item) => void }) {
  const [list, setList] = useState<BookingView[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  // Принятая заявка плавно переезжает из «Заявок» в «Ближайшие аренды»
  const [reqRef] = useAutoAnimate<HTMLUListElement>();
  const [upRef] = useAutoAnimate<HTMLUListElement>();
  const load = () => api.ownerBookings().then((r) => setList(r.bookings), () => setList((x) => x ?? []));
  useLive(load, 15000);
  useEffect(() => {
    api.items().then((r) => setItems(r.items), () => {});
  }, []);
  const today = todaySamara();
  const decide = async (b: BookingView, accept: boolean) => {
    setList((x) => x?.map((y) => (y.id === b.id ? { ...y, status: accept ? "confirmed" : "declined" } : y)) ?? x);
    try {
      await api.decide(b.id, accept);
    } catch (e) {
      tell("Не получилось", errorText(e));
    }
    load();
  };
  const hide = async (b: BookingView) => {
    if (!(await ask("Завершить аренду?", { text: "Аренда уйдёт из списка.", ok: "Завершить" }))) return;
    setList((x) => x?.filter((y) => y.id !== b.id) ?? x);
    api.hide(b.id).catch(() => load());
  };
  const setPrice = async (i: Item) => {
    const v = await askText(`Цена: ${i.title}`, i.priceDay != null ? String(i.priceDay) : "", { text: "За сутки, в рублях. Пусто — «цена по звонку».", ok: "Сохранить", placeholder: "например 5000" });
    if (v === null) return;
    const n = v.replace(/\D/g, "");
    try {
      const r = await api.price(i.id, n ? Number(n) : null);
      setItems((x) => x.map((y) => (y.id === i.id ? r.item : y)));
    } catch (e) {
      tell("Не получилось", errorText(e));
    }
  };
  if (!list) return <Spinner />;
  const requests = list.filter((b) => b.status === "requested");
  const upcoming = list.filter((b) => b.status === "confirmed");
  const row = (b: BookingView) => (
    <li key={b.id} className="card px-4 py-3.5 text-[14px]">
      <div className="flex items-start justify-between gap-3">
        <b className="line-clamp-2 min-w-0 text-[15px] leading-snug text-ink">{b.title}</b>
        <b className="shrink-0 text-ink tabular-nums">{b.total != null ? rub(b.total) : "по звонку"}</b>
      </div>
      <div className="mt-0.5 text-dim">
        {rangeText(b.from, b.to)}, {daysText(b.days)}
      </div>
      <div className="mt-0.5 text-dim">{b.delivery ? `Доставка: ${b.address}` : "Самовывоз"}</div>
      {b.discount ? <div className="mt-0.5 font-semibold text-coffee">Акция: −{b.discount}% уже в сумме</div> : null}
      {b.comment && <p className="mt-1 text-ink">«{b.comment}»</p>}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <a className="pill text-coffee tabular-nums" href={`tel:${b.phone}`}>
          <Phone size={14} aria-hidden /> {phoneText(b.phone)}
        </a>
        <span className="text-[13px] text-dim">{b.clientName ?? ""}</span>
      </div>
      {b.status === "requested" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="btn btn-main min-h-11" onClick={() => decide(b, true)}>
            Принять
          </button>
          <button className="btn btn-line min-h-11" onClick={() => decide(b, false)}>
            Отклонить
          </button>
        </div>
      ) : (
        b.to < today && (
          <button className="pill mt-3" onClick={() => hide(b)}>
            Завершить
          </button>
        )
      )}
    </li>
  );
  return (
    <>
      <h1 className="mb-3 font-display text-[22px] font-bold text-espresso">Управление</h1>
      <h2 className="mb-2 text-[17px] font-bold text-ink">Заявки {requests.length ? <span className="text-coffee">{requests.length}</span> : null}</h2>
      {requests.length ? <ul ref={reqRef} className="mb-5 space-y-3">{requests.map(row)}</ul> : <p className="mb-5 text-[14px] text-dim">Новых заявок нет. Они приходят и в чат с ботом, с кнопками.</p>}
      {upcoming.length > 0 && (
        <>
          <h2 className="mb-2 text-[17px] font-bold text-ink">Ближайшие аренды</h2>
          <ul ref={upRef} className="mb-5 space-y-3">{upcoming.map(row)}</ul>
        </>
      )}
      <h2 className="mb-2 text-[17px] font-bold text-ink">Оборудование</h2>
      <ul className="card divide-y divide-line">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-3 py-3">
            <ItemPicture item={i} className="size-12 shrink-0 rounded-lg" size={22} small />
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-[15px] leading-snug font-semibold text-ink">{i.title}</div>
              <div className="text-[13px] text-dim tabular-nums">{i.priceDay != null ? `${rub(i.priceDay)} в сутки` : "цена по звонку"}</div>
            </div>
            <button className="grid size-10 place-items-center rounded-full text-coffee" onClick={() => setPrice(i)} aria-label={`Цена: ${i.title}`}>
              <Pencil size={18} />
            </button>
            <button className="grid size-10 place-items-center rounded-full text-coffee" onClick={() => props.onCalendar(i)} aria-label={`Календарь: ${i.title}`}>
              <CalendarDays size={18} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Календарь техники для владельца: нажал на день — закрыл (ремонт, свои работы) или открыл. Дни аренд — тёмные */
export function OwnerCalendar(props: { item: Item }) {
  const today = todaySamara();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [booked, setBooked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const pending = useRef(new Map<string, boolean>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    api.calendar(props.item.id, [], []).then((r) => {
      setClosed(new Set(r.closed));
      setBooked(new Set(r.booked));
    });
  }, [props.item.id]);
  // Нажатия копятся и уходят одним запросом через 300 мс — календарь не тормозит
  const flush = async () => {
    const batch = [...pending.current];
    pending.current.clear();
    if (!batch.length) return;
    setSaving(true);
    try {
      const r = await api.calendar(props.item.id, batch.filter(([, c]) => c).map(([d]) => d), batch.filter(([, c]) => !c).map(([d]) => d));
      setClosed(new Set(r.closed));
      setBooked(new Set(r.booked));
    } catch (e) {
      tell("Не сохранилось", errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const toggle = (d: string) => {
    const close = !closed.has(d);
    setClosed((s) => {
      const n = new Set(s);
      if (close) n.add(d);
      else n.delete(d);
      return n;
    });
    pending.current.set(d, close);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 300);
  };
  return (
    <>
      <h1 className="font-display text-[22px] font-bold text-espresso">{props.item.title}</h1>
      <p className="mt-1 mb-4 text-[14px] text-dim">Нажмите на день, чтобы закрыть или открыть его для заявок. {saving ? "Сохраняем…" : ""}</p>
      <div className="card p-4">
        <MonthGrid
          today={today}
          day={(d) => (
            <button
              disabled={d < today || booked.has(d)}
              onClick={() => toggle(d)}
              className={`aspect-square w-full rounded-lg text-[15px] tabular-nums ${booked.has(d) ? "bg-coffee font-semibold text-on-coffee" : closed.has(d) ? "day-off" : d < today ? "text-line" : "bg-surface-2/50 text-ink"}`}
              aria-label={`${Number(d.slice(8))}: ${booked.has(d) ? "аренда" : closed.has(d) ? "закрыто" : "свободно"}`}
            >
              {Number(d.slice(8))}
            </button>
          )}
        />
      </div>
      <ul className="mt-3 space-y-1 text-[14px] text-dim">
        <li className="flex items-center gap-2">
          <span className="size-4 rounded bg-coffee" /> аренда
        </li>
        <li className="flex items-center gap-2">
          <span className="day-off size-4 rounded" /> закрыто вами
        </li>
      </ul>
    </>
  );
}
