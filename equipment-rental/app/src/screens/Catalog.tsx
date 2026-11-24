import { useEffect, useState } from "react";
import { CATEGORIES } from "../../../shared/catalog.ts";
import { rub } from "../../../shared/dates.ts";
import type { Item } from "../../../shared/types.ts";
import { api, errorText, type Me } from "../lib/api.ts";
import { Promo } from "../ui/Promo.tsx";
import { Spin } from "../ui/Spin.tsx";
import { ItemIcon, ItemPicture, Spinner } from "../ui/ui.tsx";

/** Каталог: стеклянная шапка с условиями, подарок и оборудование по разделам — плитками по две в ряд */
export function CatalogScreen(props: { me: Me; onPromo: (promoAt: number) => void; onSpin: (reward: { spinAt: number; spinPercent: number; spinExpiresAt: number }) => void; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [delivery, setDelivery] = useState(500);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.items().then(
      (r) => {
        setItems(r.items);
        setDelivery(r.delivery);
      },
      (e) => setError(errorText(e)),
    );
  }, []);
  return (
    <>
      {/* Шапка: стеклянная карточка поверх тёплых светящихся пятен, по ней раз в несколько секунд пробегает блик.
          По мотивам «Glass Shine Card» с 21st.dev, переложено в палитру приложения */}
      <section className="relative -mx-4 -mt-4 mb-4 overflow-hidden bg-oak px-4 pt-4 pb-5 text-espresso">
        <span className="orb orb-a" aria-hidden />
        <span className="orb orb-b" aria-hidden />
        <span className="orb orb-c" aria-hidden />
        <div className="glass relative overflow-hidden rounded-3xl p-5">
          <h1 className="glass-title font-display text-[26px] leading-[1.15] font-bold">Аренда оборудования в Самаре и области</h1>
          <div className="mt-3 flex flex-wrap gap-2 text-[13px] font-medium">
            <span className="rounded-full bg-white/70 px-3 py-1">Оплата за сутки</span>
            <span className="rounded-full bg-white/70 px-3 py-1">Доставка по городу {rub(delivery)}</span>
            <span className="rounded-full bg-white/70 px-3 py-1">Без залога</span>
          </div>
          <span className="glass-shine" aria-hidden />
        </div>
        <Promo me={props.me} onOpened={props.onPromo} />
        <Spin me={props.me} onSpin={props.onSpin} />
      </section>
      {error && <p className="text-bad">{error}</p>}
      {!items && !error && <Spinner />}
      {CATEGORIES.map((c) => {
        const list = items?.filter((i) => i.category === c.id) ?? [];
        if (!list.length) return null;
        return (
          <section key={c.id} className="mb-5">
            <h2 className="mb-2.5 font-display text-[20px] font-bold text-espresso">{c.title}</h2>
            <ul className="grid grid-cols-2 gap-2.5">
              {list.map((i) => (
                <li key={i.id}>
                  <button
                    className="card relative flex aspect-[4/5] w-full flex-col overflow-hidden p-3 text-left transition-transform active:scale-[0.98]"
                    onClick={() => props.onOpen(i.id)}
                  >
                    <span className="relative z-10 line-clamp-3 text-[14px] leading-snug font-semibold text-ink">{i.title}</span>
                    {i.photos[0] ? (
                      <ItemPicture item={i} className="absolute right-1.5 bottom-1.5 h-[58%] w-[78%]" size={40} small />
                    ) : (
                      <ItemIcon item={i} className="absolute right-3 bottom-3 size-[72px]" size={32} />
                    )}
                    <span className="relative z-10 mt-auto self-start rounded-full bg-hot px-2.5 py-1 text-[12px] font-bold whitespace-nowrap text-hot-ink tabular-nums">
                      {i.priceDay != null ? `${rub(i.priceDay)}/сутки` : "по звонку"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
