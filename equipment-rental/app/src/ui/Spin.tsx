import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { SPIN_COOLDOWN, activeDiscount, promoActive } from "../../../shared/promo.ts";
import { api, errorText, type Me } from "../lib/api.ts";
import { haptic } from "../lib/max.ts";

const cards = [
  { image: "./photos/drill-s.webp", title: "Дрель" },
  { image: "./photos/grinder-s.webp", title: "Болгарка" },
  { image: "./photos/wv1-s.webp", title: "Стеклоочиститель" },
];

export function Spin(props: { me: Me; onSpin: (reward: { spinAt: number; spinPercent: number; spinExpiresAt: number }) => void }) {
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const next = (props.me.spinAt ?? 0) + SPIN_COOLDOWN;
  const available = now >= next;
  const starter = !props.me.promoUsed && promoActive(props.me.promoAt, now);
  const options = starter ? [5] : [5, 10, 15];
  const discount = activeDiscount(props.me.promoAt, props.me.promoUsed, props.me.spinPercent, props.me.spinExpiresAt, now);
  const left = Math.max(0, Math.ceil((next - now) / 1000));
  const time = `${String(Math.floor(left / 3600)).padStart(2, "0")}:${String(Math.floor(left / 60) % 60).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;

  const spin = async () => {
    if (busy || !available) return;
    setBusy(true);
    setError("");
    haptic("tap");
    try {
      const reward = await api.spin();
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const target = 12 + options.indexOf(reward.spinPercent);
      setOffset(0);
      setMotion(false);
      setRolling(true);
      if (!reduce) {
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
    <section className="mt-3 rounded-2xl bg-surface p-4 text-ink shadow-[0_6px_18px_rgb(74_52_36/0.1)]" aria-label="Ежедневный бесплатный спин">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[18px] font-bold text-espresso">Ежедневный спин</h2>
          <p className="text-[12px] text-dim">Бесплатно раз в 24 часа · скидка от 5 до 15%</p>
        </div>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-hot text-hot-ink"><Gift size={21} /></span>
      </div>
      <div className="relative mt-3 overflow-hidden rounded-xl bg-coffee-soft py-3">
        <div className="absolute inset-y-1 left-1/2 z-10 w-0.5 bg-hot-ink" aria-hidden />
        <div className="flex gap-2" style={{ transform: `translateX(calc(50% - 48px - ${offset * 104}px))`, transition: motion && rolling ? "transform 2.3s cubic-bezier(.12,.72,.16,1)" : "none" }}>
          {Array.from({ length: 18 }, (_, i) => {
            const card = cards[i % cards.length];
            return <div key={i} className="flex w-24 shrink-0 flex-col items-center rounded-xl bg-white p-2 text-center shadow-sm">
              <img src={card.image} alt={card.title} className="size-14 object-contain" />
              <span className="text-[11px] text-dim">{card.title}</span>
              <b className="text-[15px] text-coffee">−{options[i % options.length]}%</b>
            </div>;
          })}
        </div>
      </div>
      {discount > 0 && <p className="mt-2 text-[13px] font-semibold text-coffee">Сейчас ваша скидка: {discount}%{props.me.spinExpiresAt && now < props.me.spinExpiresAt ? ` · до ${new Date(props.me.spinExpiresAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>}
      {starter && <p className="mt-1 text-[12px] text-dim">Пока действует стартовая скидка 15%, спин добавит 5% без продления срока.</p>}
      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
      <button type="button" className="btn btn-main mt-3 w-full" disabled={busy || !available} onClick={spin}>
        {busy ? "Крутим…" : available ? "Крутить бесплатно" : `Следующий спин через ${time}`}
      </button>
    </section>
  );
}
