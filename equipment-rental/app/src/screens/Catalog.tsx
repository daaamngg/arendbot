import { useEffect, useRef, useState } from "react";
import { CATEGORIES } from "../../../shared/catalog.ts";
import { rub } from "../../../shared/dates.ts";
import { PACKAGES } from "../../../shared/packages.ts";
import { activeDiscount } from "../../../shared/promo.ts";
import type { Item } from "../../../shared/types.ts";
import { api, errorText, type Me } from "../lib/api.ts";
import { Spin } from "../ui/Spin.tsx";
import { ItemIcon, ItemPicture, Spinner } from "../ui/ui.tsx";

/** Каталог: стеклянная шапка с условиями, подарок и оборудование по разделам — плитками по две в ряд */
export function CatalogScreen(props: { me: Me; onPromo: (promoAt: number) => void; onSpin: (reward: { spinAt: number; spinPercent: number; spinExpiresAt: number }) => void; onOpen: (id: string, days?: number) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [delivery, setDelivery] = useState(500);
  const [error, setError] = useState<string | null>(null);
  const [packageDays, setPackageDays] = useState<Record<string, number>>({});
  const [activePackage, setActivePackage] = useState(0);
  const [packagePaused, setPackagePaused] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (packagePaused) return;
    const timer = setTimeout(() => setActivePackage((i) => (i + 1) % PACKAGES.length), 6000);
    return () => clearTimeout(timer);
  }, [activePackage, packagePaused]);
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
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-display text-lg font-bold">Пакеты услуг</h2><div className="flex gap-1" aria-label="Выбрать пакет">{PACKAGES.map((pack, i) => <button key={pack.id} type="button" aria-label={pack.title} aria-current={i === activePackage ? "true" : undefined} onClick={() => setActivePackage(i)} className={`h-2.5 rounded-full transition-all ${i === activePackage ? "w-7 bg-coffee" : "w-2.5 bg-coffee/30"}`} />)}</div></div>
            {(() => { const pack = PACKAGES[activePackage]; const days = packageDays[pack.id] ?? 1; const daily = pack.itemIds.reduce((sum, id) => sum + (items?.find((i) => i.id === id)?.priceDay ?? 0), 0); const discount = activeDiscount(props.me.promoAt, props.me.promoUsed, props.me.spinPercent, props.me.spinExpiresAt, Date.now(), days); return <div key={pack.id} onFocusCapture={() => setPackagePaused(true)} onBlurCapture={() => setPackagePaused(false)} onTouchStart={(e) => { swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }} onTouchEnd={(e) => { const start = swipeStart.current; swipeStart.current = null; if (!start) return; const dx = e.changedTouches[0].clientX - start.x; const dy = e.changedTouches[0].clientY - start.y; if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) setActivePackage((i) => (i + (dx < 0 ? 1 : PACKAGES.length - 1)) % PACKAGES.length); }} onTouchCancel={() => { swipeStart.current = null; }} className="glass package-enter relative min-h-[200px] touch-pan-y overflow-hidden rounded-2xl p-4"><h3 className="relative z-10 font-bold">{pack.title}</h3><p className="relative z-10 mt-1 text-xs">{pack.names.join(" · ")}</p><div className="relative z-10 mt-3 flex items-center justify-between gap-2"><label className="text-sm">Дней <select className="ml-1 rounded-lg bg-white p-2" value={days} onChange={(e) => setPackageDays((old) => ({ ...old, [pack.id]: Number(e.target.value) }))}>{Array.from({ length: 30 }, (_, n) => <option key={n + 1} value={n + 1}>{n + 1}</option>)}</select></label><strong className="text-lg">{items ? rub(Math.round(daily * days * (100 - discount) / 100)) : "…"}</strong></div><p className="relative z-10 text-[11px]">Без доставки{discount ? ` · скидка ${discount}% учтена` : ""}</p><button className="btn btn-main relative z-10 mt-3 w-full" disabled={!items} onClick={() => props.onOpen(pack.id, days)}>Добавить в заявку</button><span className="glass-shine" aria-hidden /></div>; })()}
          </div>
          <span className="glass-shine" aria-hidden />
        </div>
        <Spin me={props.me} onPromo={props.onPromo} onSpin={props.onSpin} />
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
