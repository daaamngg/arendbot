import { useState } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { CalendarDays } from "lucide-react";
import { daysText, rangeText, rub, todaySamara } from "../../../shared/dates.ts";
import { DELIVERY_PRICE } from "../../../shared/types.ts";
import { api, errorText, type BookingView } from "../lib/api.ts";
import { useLive } from "../lib/live.ts";
import { ask, tell } from "../ui/dialog.tsx";
import { Spinner, Status } from "../ui/ui.tsx";

/** Мои заявки: что, когда, сумма и ответ владельца; отменить можно до начала аренды */
export function MyScreen(props: { onCatalog: () => void }) {
  const [list, setList] = useState<BookingView[] | null>(null);
  // Карточки плавно встают на место, когда заявка появилась или отменена
  const [listRef] = useAutoAnimate<HTMLUListElement>();
  useLive(() => api.my().then((r) => setList(r.bookings), () => setList((x) => x ?? [])), 15000);
  const today = todaySamara();
  const cancel = async (b: BookingView) => {
    if (!(await ask("Отменить заявку?", { text: "Дни снова станут свободными.", ok: "Отменить", danger: true }))) return;
    try {
      await api.cancel(b.id);
      setList((x) => x?.map((y) => (y.id === b.id ? { ...y, status: "cancelled" } : y)) ?? x);
    } catch (e) {
      tell("Не получилось", errorText(e));
    }
  };
  if (!list) return <Spinner />;
  return (
    <>
      <h1 className="mb-3 font-display text-[22px] font-bold text-espresso">Мои заявки</h1>
      {list.length === 0 ? (
        <div className="card flex flex-col items-center px-5 py-7 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-coffee-soft text-coffee">
            <CalendarDays size={26} aria-hidden />
          </span>
          <p className="mt-3 font-semibold text-ink">Заявок пока нет</p>
          <p className="mt-1 max-w-[280px] text-[14px] text-dim">Выберите оборудование и свободные дни, владелец ответит в чате с ботом.</p>
          <button className="btn btn-main mt-4 px-6" onClick={props.onCatalog}>
            Выбрать оборудование
          </button>
        </div>
      ) : (
        <ul ref={listRef} className="space-y-3">
          {list.map((b) => (
            <li key={b.id} className="card px-4 py-3.5 text-[14px]">
              <div className="flex items-start justify-between gap-3">
                <b className="line-clamp-2 min-w-0 text-[15px] leading-snug text-ink">{b.title}</b>
                <Status status={b.status} />
              </div>
              <div className="mt-1 text-dim">
                {rangeText(b.from, b.to)}, {daysText(b.days)}
              </div>
              <div className="mt-0.5 text-dim">{b.delivery ? `Доставка: ${b.address}` : "Самовывоз"}</div>
              <div className="mt-2 flex items-center justify-between gap-3">
                {b.discount ? <span className="mr-1.5 rounded-full bg-hot px-2 py-0.5 text-[12px] font-bold text-hot-ink">−{b.discount}%</span> : null}
                <b className="mr-auto text-ink tabular-nums">{b.total != null ? rub(b.total) : `цена по звонку${b.delivery ? ` + ${rub(DELIVERY_PRICE)}` : ""}`}</b>
                {(b.status === "requested" || b.status === "confirmed") && b.from >= today && (
                  <button className="pill text-bad" onClick={() => cancel(b)}>
                    Отменить
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
