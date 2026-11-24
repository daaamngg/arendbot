import { useEffect, useState } from "react";
import { ChevronRight, Gift, X } from "lucide-react";
import { SPIN_COOLDOWN, activeDiscount, promoActive } from "../../../shared/promo.ts";
import { api, errorText, type Me } from "../lib/api.ts";
import { haptic } from "../lib/max.ts";

const tools = [
  { image: "./photos/drill-s.webp", title: "Дрель" },
  { image: "./photos/grinder-s.webp", title: "Болгарка" },
  { image: "./photos/wv1-s.webp", title: "Стеклоочиститель" },
];
const raffle = [
  { image: "./photos/raffle-phone.png", title: "iPhone" },
  { image: "./photos/raffle-tablet.png", title: "iPad" },
  { image: "./photos/raffle-console.png", title: "PlayStation" },
];
// Частота карточек соответствует шансам скидок: 70% / 25% / 5%.
const slots: (5 | 10 | 15)[] = [5, 5, 10, 5, 5, 5, 10, 5, 5, 5, 10, 5, 5, 5, 10, 5, 5, 5, 10, 15];
const clock = (left: number) => `${String(Math.floor(left / 3600)).padStart(2, "0")}:${String(Math.floor(left / 60) % 60).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;

export function Spin(props: { me: Me; onSpin: (reward: { spinAt: number; spinPercent: number; spinExpiresAt: number }) => void }) {
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", onKey); };
  }, [open]);

  const next = (props.me.spinAt ?? 0) + SPIN_COOLDOWN;
  const available = now >= next;
  const starter = !props.me.promoUsed && promoActive(props.me.promoAt, now);
  const displaySlots = starter ? slots.map(() => 5 as const) : slots;
  const spinActive = !!props.me.spinExpiresAt && now < props.me.spinExpiresAt;
  const discount = activeDiscount(props.me.promoAt, props.me.promoUsed, props.me.spinPercent, props.me.spinExpiresAt, now);
  const left = Math.max(0, Math.ceil((next - now) / 1000));

  const spin = async () => {
    if (busy || !available) return;
    setBusy(true);
    setError("");
    haptic("tap");
    try {
      const reward = await api.spin();
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const target = starter ? 17 : reward.spinPercent === 15 ? 19 : reward.spinPercent === 10 ? 18 : 17;
      setOffset(0);
      setMotion(false);
      setRolling(true);
      if (!reduced) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        setMotion(true);
        setOffset(target);
        await new Promise((resolve) => setTimeout(resolve, 2400));
      } else setOffset(target);
      props.onSpin(reward);
      haptic("success");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRolling(false);
      setBusy(false);
    }
  };

  return (
    <>
      {spinActive ? (
        <button type="button" className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 text-left text-ink shadow-[0_6px_18px_rgb(74_52_36/0.1)]" onClick={() => setOpen(true)}>
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-hot text-hot-ink"><Gift size={19} /></span>
          <span className="min-w-0 flex-1 text-[13px] font-semibold">Ваша скидка −{discount}% <span className="block text-[11px] font-normal text-dim">действует до {new Date(props.me.spinExpiresAt!).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></span>
          <ChevronRight size={17} className="shrink-0 text-coffee" />
        </button>
      ) : (
        <button type="button" className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-hot px-4 py-3 text-left text-hot-ink shadow-[0_6px_18px_rgb(245_184_0/0.3)]" onClick={() => setOpen(true)}>
          <Gift size={22} className="shrink-0" />
          <span className="flex-1 text-[15px] font-bold">{available ? "Забрать бонус дня" : `Следующий бонус через ${clock(left)}`}</span>
          <ChevronRight size={20} />
        </button>
      )}

      {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
        <section role="dialog" aria-modal="true" aria-label="Ежедневный бесплатный спин" className="max-h-[92dvh] w-full max-w-[540px] overflow-y-auto rounded-t-3xl bg-surface p-4 text-ink shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h2 className="font-display text-[21px] font-bold text-espresso">Бонус дня</h2>
              <p className="text-[12px] text-dim">Бесплатный спин раз в 24 часа</p>
            </div>
            <button type="button" className="grid size-9 place-items-center rounded-full bg-coffee-soft text-coffee" aria-label="Закрыть" onClick={() => setOpen(false)}><X size={19} /></button>
          </div>
          <div className="relative mt-4 overflow-hidden rounded-xl bg-coffee-soft py-3">
            <div className="absolute inset-y-1 left-1/2 z-10 w-0.5 bg-hot-ink" aria-hidden />
            <div className="flex gap-2" style={{ transform: `translateX(calc(50% - 48px - ${offset * 104}px))`, transition: motion && rolling ? "transform 2.3s cubic-bezier(.12,.72,.16,1)" : "none" }}>
              {displaySlots.map((percent, i) => {
                const card = tools[i % tools.length];
                return <div key={i} className="flex w-24 shrink-0 flex-col items-center rounded-xl bg-white p-2 text-center shadow-sm">
                  <img src={card.image} alt="" className="size-14 object-contain" />
                  <span className="text-[11px] text-dim">{card.title}</span>
                  <b className="text-[15px] text-coffee">−{percent}%</b>
                </div>;
              })}
            </div>
          </div>
          <p className="mt-3 text-[12px] text-dim">{starter ? "Пока действуют стартовые 15%, спин добавит 5% без продления срока." : "Шансы: скидка 5% — 70%, 10% — 25%, 15% — 5%. Скидка действует 24 часа."}</p>
          {spinActive && <p className="mt-3 rounded-xl bg-coffee-soft px-3 py-2 text-[14px] font-semibold text-coffee">Сейчас ваша скидка −{discount}%</p>}
          {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
          <button type="button" className="btn btn-main mt-4 w-full" disabled={busy || !available} onClick={spin}>{busy ? "Крутим…" : available ? "Крутить бесплатно" : `Следующий спин через ${clock(left)}`}</button>
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-[13px] font-semibold">Планируемый отдельный розыгрыш</p>
            <p className="text-[11px] text-dim">Эти предметы не выпадают в ежедневном спине. Условия объявим отдельно.</p>
            <div className="mt-2 grid grid-cols-3 gap-2">{raffle.map((item) => <div key={item.title} className="rounded-xl bg-white p-2 text-center"><img src={item.image} alt="" loading="lazy" className="mx-auto h-16 w-full object-contain" /><span className="text-[11px] font-medium">{item.title}</span></div>)}</div>
          </div>
        </section>
      </div>}
    </>
  );
}
