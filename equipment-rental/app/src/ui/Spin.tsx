import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Gift, X } from "lucide-react";
import { SPIN_COOLDOWN, activeDiscount, promoActive } from "../../../shared/promo.ts";
import { api, errorText, type Me } from "../lib/api.ts";
import { haptic } from "../lib/max.ts";
import { Promo } from "./Promo.tsx";

const tools = [
  { image: "./photos/drill-s.webp", title: "Дрель" },
  { image: "./photos/grinder-s.webp", title: "Болгарка" },
  { image: "./photos/wv1-s.webp", title: "Стеклоочиститель" },
];
const showcase = [
  { image: "./photos/raffle-phone.png", title: "iPhone" },
  { image: "./photos/raffle-tablet.png", title: "iPad" },
  { image: "./photos/raffle-console.png", title: "PlayStation" },
];
// Частота карточек соответствует шансам скидок: 70% / 25% / 5%.
const slots: (5 | 10 | 15)[] = [5, 5, 10, 5, 5, 5, 10, 5, 5, 5, 10, 5, 5, 5, 10, 5, 5, 5, 10, 15];
const REEL_HEAD = 4;
const CARD_STEP = 104;
const SPIN_MS = 7200;
const reelPosition = (index: number) => `translate3d(-${48 + index * CARD_STEP}px, 0, 0)`;
const clock = (left: number) => `${String(Math.floor(left / 3600)).padStart(2, "0")}:${String(Math.floor(left / 60) % 60).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;

export function Spin(props: { me: Me; onPromo: (promoAt: number) => void; onSpin: (reward: { spinAt: number; spinPercent: number; spinExpiresAt: number }) => void }) {
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(() => { try { if (sessionStorage.getItem("tehnika-spin-shown")) return false; sessionStorage.setItem("tehnika-spin-shown", "1"); return true; } catch { return true; } });
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(REEL_HEAD);
  const reelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!open) return;
    for (const { image } of [...tools, ...showcase]) { const preload = new Image(); preload.src = image; void preload.decode?.().catch(() => {}); }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", onKey); };
  }, [open]);

  const next = (props.me.spinAt ?? 0) + SPIN_COOLDOWN;
  const available = now >= next;
  const starter = !props.me.promoUsed && promoActive(props.me.promoAt, now);
  const displaySlots = useMemo(() => starter ? slots.map(() => 5 as const) : slots, [starter]);
  // Карточки до и после основной ленты сохраняют заполненным окно у обоих краёв.
  const reelSlots = useMemo(() => [...displaySlots.slice(-REEL_HEAD), ...displaySlots, ...displaySlots.slice(0, 6)], [displaySlots]);
  const spinActive = !!props.me.spinExpiresAt && now < props.me.spinExpiresAt;
  const discount = activeDiscount(props.me.promoAt, props.me.promoUsed, props.me.spinPercent, props.me.spinExpiresAt, now);
  const oneDayDiscount = activeDiscount(props.me.promoAt, props.me.promoUsed, props.me.spinPercent, props.me.spinExpiresAt, now, 1);
  const left = Math.max(0, Math.ceil((next - now) / 1000));

  const spin = async (preview = false) => {
    if (busy || (!available && !preview)) return;
    setBusy(true);
    setError("");
    haptic("tap");
    try {
      const reward = preview ? await api.spinPreview() : await api.spin();
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const target = REEL_HEAD + (starter ? 17 : reward.spinPercent === 15 ? 19 : reward.spinPercent === 10 ? 18 : 17);
      setOffset(REEL_HEAD);
      setRolling(true);
      if (!reduced) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const animation = reelRef.current?.animate(
          [{ transform: reelPosition(REEL_HEAD) }, { transform: reelPosition(target) }],
          { duration: SPIN_MS, easing: "cubic-bezier(.16,.62,.22,1)", fill: "forwards" },
        );
        if (animation) {
          await Promise.race([animation.finished.catch(() => {}), new Promise((resolve) => setTimeout(resolve, SPIN_MS + 500))]);
          setOffset(target);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          animation.cancel();
        } else setOffset(target);
      } else setOffset(target);
      if (!preview) props.onSpin(reward as { spinAt: number; spinPercent: number; spinExpiresAt: number });
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
      {spinActive || starter ? (
        <button type="button" className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 text-left text-ink shadow-[0_6px_18px_rgb(74_52_36/0.1)]" onClick={() => setOpen(true)}>
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-hot text-hot-ink"><Gift size={19} /></span>
          <span className="min-w-0 flex-1 text-[13px] font-semibold">Ваши бонусы: до −{discount}% <span className="block text-[11px] font-normal text-dim">1 сутки −{oneDayDiscount}% · от 2 суток −{discount}%</span></span>
          <ChevronRight size={17} className="shrink-0 text-coffee" />
        </button>
      ) : (
        <button type="button" className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-hot px-4 py-3 text-left text-hot-ink shadow-[0_6px_18px_rgb(245_184_0/0.3)]" onClick={() => setOpen(true)}>
          <Gift size={22} className="shrink-0" />
          <span className="flex-1 text-[15px] font-bold">Бонусы и скидки</span>
          <ChevronRight size={20} />
        </button>
      )}

      {open && createPortal(<div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
        <section role="dialog" aria-modal="true" aria-label="Ежедневный бесплатный спин" className="spin-dialog max-h-[92dvh] w-full max-w-[540px] overflow-y-auto rounded-t-3xl bg-surface p-4 text-ink shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h2 className="font-display text-[21px] font-bold text-espresso">Бонус дня</h2>
              <p className="text-[12px] text-dim">Бесплатный спин раз в 24 часа</p>
            </div>
            <button type="button" className="grid size-9 place-items-center rounded-full bg-coffee-soft text-coffee" aria-label="Закрыть" onClick={() => setOpen(false)}><X size={19} /></button>
          </div>
          <Promo me={props.me} onOpened={props.onPromo} />
          {(starter || spinActive) && <div className="mt-4 rounded-xl bg-coffee-soft p-3 text-[13px] text-coffee"><b>Ваша общая скидка</b><p className="mt-1">На 1 сутки: −{oneDayDiscount}%. От 2 суток: −{discount}%.</p><p className="mt-1 text-[11px]">Стартовые 15% действуют на первую аренду от 2 суток. Награда спина действует на любой срок. Скидки складываются, срок не продлевается.</p></div>}
          <div className={`spin-track relative mt-4 overflow-hidden rounded-xl py-3 ${rolling ? "rolling" : ""}`}>
            <div className="absolute inset-y-1 left-1/2 z-10 w-0.5 bg-hot-ink" aria-hidden />
            <div ref={reelRef} className="spin-reel flex gap-2" style={{ transform: reelPosition(offset) }}>
              {reelSlots.map((percent, i) => {
                const gadget = i >= REEL_HEAD + 14 && i <= REEL_HEAD + 16 ? showcase[i - REEL_HEAD - 14] : null;
                const card = gadget ?? tools[i % tools.length];
                return <div key={i} className="flex w-24 shrink-0 flex-col items-center rounded-xl bg-white p-2 text-center shadow-sm">
                  <img src={card.image} alt="" className="size-14 object-contain" />
                  <span className="w-full text-[11px] leading-tight text-dim" style={{ overflowWrap: "anywhere" }}>{card.title}</span>
                  <b className="text-[15px] text-coffee">{gadget ? "★" : `−${percent}%`}</b>
                </div>;
              })}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">{showcase.map((item) => <img key={item.title} src={item.image} alt={item.title} className="size-10 rounded-lg bg-white object-contain p-1" />)}</div>
          <p className="mt-3 text-[12px] text-dim">{starter ? "Пока действуют стартовые 15%, спин добавит 5% без продления срока." : "Шансы: скидка 5% — 70%, 10% — 25%, 15% — 5%. Скидка действует 24 часа."}</p>
          {spinActive && <p className="mt-3 rounded-xl bg-coffee-soft px-3 py-2 text-[14px] font-semibold text-coffee">Сейчас ваша скидка −{discount}%</p>}
          {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
          <button type="button" className="btn btn-main spin-button mt-4 w-full" disabled={busy || !available} onClick={() => spin()}>{busy ? "Крутим…" : available ? "Крутить бесплатно" : `Следующий спин через ${clock(left)}`}</button>
          {props.me.owner && <button type="button" className="mt-3 w-full rounded-xl border border-coffee p-3 text-sm font-semibold text-coffee" disabled={busy} onClick={() => spin(true)}>Пробный спин владельца · без скидки</button>}
        </section>
      </div>, document.body)}
    </>
  );
}
