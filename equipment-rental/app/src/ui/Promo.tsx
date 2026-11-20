import { useEffect, useRef, useState } from "react";
import { ChevronRight, Flame, Gift, Percent } from "lucide-react";
import { PROMO, promoEnd } from "../../../shared/promo.ts";
import { api, type Me } from "../lib/api.ts";
import { haptic } from "../lib/max.ts";

// Подарок-акция: сдвинул ползунок — подарок открылся, конфетти, скидка и личный таймер.
// Время открытия хранится на сервере: при новом входе таймер продолжается, а не начинается заново.
// По мотивам «Reward Card» с 21st.dev, но без framer-motion и react-confetti: свайп и конфетти свои, легче и быстрее

const HANDLE = 56; // размер круглой ручки, px
const plural = (n: number, [one, few, many]: [string, string, string]) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const pad = (n: number) => String(n).padStart(2, "0");

/** Секунды до end. Тикает только пока приложение на экране; вернулись — сразу пересчёт от настоящего времени */
function useLeft(end: number) {
  const calc = () => Math.max(0, Math.floor((end - Date.now()) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    const tick = () => setLeft(calc());
    let t: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(t);
      if (document.visibilityState !== "visible") return;
      tick();
      t = setInterval(tick, 1000);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", start);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end]);
  return left;
}

/** Конфетти на холсте поверх экрана: ~2,5 секунды, потом холст убирается. Цвета — из палитры приложения */
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth;
  const h = innerHeight;
  c.width = w * dpr;
  c.height = h * dpr;
  c.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60";
  document.body.append(c);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  const colors = ["#f5b800", "#6b4a35", "#a8743f", "#3f6b3a", "#15110d", "#c43d1b"];
  const parts = Array.from({ length: 140 }, () => ({
    x: w / 2 + (Math.random() - 0.5) * 80,
    y: h * 0.35,
    vx: (Math.random() - 0.5) * 13,
    vy: -Math.random() * 13 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    s: 5 + Math.random() * 6,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const frame = (t: number) => {
    const life = (t - t0) / 2600;
    if (life >= 1) return c.remove();
    g.clearRect(0, 0, w, h);
    g.globalAlpha = Math.min(1, (1 - life) * 2.5);
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.fillStyle = p.c;
      g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      g.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Ползунок «сдвиньте, чтобы открыть». Двигаем прямо через style — без перерисовки React на каждый пиксель */
function Slider(props: { onUnlock: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ start: number; max: number; x: number } | null>(null);
  const place = (x: number, animate = false) => {
    const el = handle.current!;
    el.style.transition = animate ? "transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
    el.style.transform = `translateX(${x}px)`;
    label.current!.style.opacity = String(Math.max(0, 1 - x / 60));
  };
  const finish = () => {
    const max = (track.current?.offsetWidth ?? 0) - HANDLE;
    place(max, true);
    haptic("success");
    setTimeout(props.onUnlock, 220);
  };
  return (
    <div ref={track} className="relative mt-5 h-14 w-full rounded-full bg-surface-2">
      <span ref={label} className="shimmer absolute inset-0 flex items-center justify-center pl-14 text-[14px] font-semibold">
        Сдвиньте, чтобы открыть
      </span>
      <button
        ref={handle}
        aria-label="Открыть подарок"
        className="absolute top-0 left-0 z-10 grid size-14 cursor-grab touch-none place-items-center rounded-full bg-coffee text-on-coffee shadow-[0_2px_8px_rgb(74_52_36/0.3)] active:cursor-grabbing"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { start: e.clientX, max: (track.current?.offsetWidth ?? 0) - HANDLE, x: 0 };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          d.x = Math.min(d.max, Math.max(0, e.clientX - d.start));
          place(d.x);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          // Дотянул больше чем на 80% — открываем, иначе ручка возвращается назад
          if (d.x > d.max * 0.8) finish();
          else place(0, true);
        }}
        onPointerCancel={() => {
          drag.current = null;
          place(0, true);
        }}
        // С клавиатуры и для экранного диктора — открывается обычным нажатием
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          finish();
        }}
      >
        <ChevronRight size={24} />
      </button>
    </div>
  );
}

/** Число, у которого каждая сменившаяся цифра въезжает сверху (ключ = позиция + цифра) */
function Roll(props: { text: string }) {
  return (
    <>
      {[...props.text].map((ch, i) => (
        <span key={`${i}${ch}`} className="tick">
          {ch}
        </span>
      ))}
    </>
  );
}

const split = (left: number) => ({ d: Math.floor(left / 86400), h: Math.floor((left % 86400) / 3600), m: Math.floor((left % 3600) / 60), s: left % 60 });

/** Таймер ячейками в одну строку: дни · часы · минуты · секунды. Ширина фиксирована — на телефоне не переносится */
function Countdown(props: { left: number }) {
  const { d, h, m, s } = split(props.left);
  const cells: [string, string][] = [
    [String(d), plural(d, ["день", "дня", "дней"])],
    [pad(h), "часов"],
    [pad(m), "минут"],
    [pad(s), "секунд"],
  ];
  return (
    <div className="flex items-start justify-center gap-1.5" role="timer" aria-label={`Сгорит через ${d} ${cells[0][1]} ${h} ч ${m} мин`}>
      {cells.map(([v, label], i) => (
        <div key={label} className="flex items-start gap-1.5" aria-hidden>
          {i > 0 && <span className="pt-2.5 font-display text-[22px] font-bold text-wood">:</span>}
          <div className="w-[60px] text-center">
            <div className="grid h-[54px] place-items-center overflow-hidden rounded-xl bg-coffee-soft font-display text-[26px] font-bold text-espresso tabular-nums">
              <span>
                <Roll text={v} />
              </span>
            </div>
            <div className="mt-1 text-[11px] font-medium text-dim">{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Скидка жёлтой плашкой */
function Badge() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-full bg-hot py-2 pr-2 pl-5 text-left text-hot-ink shadow-[0_6px_18px_rgb(245_184_0/0.3)]">
      <div className="min-w-0 leading-tight">
        <p className="text-[16px] font-bold">
          −{PROMO.percent}% {PROMO.title}
        </p>
        <p className="text-[12px] font-medium opacity-75">{PROMO.terms}</p>
      </div>
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-hot-ink text-hot">
        <Percent size={22} strokeWidth={2.5} />
      </span>
    </div>
  );
}

/** Подарок уже открыт раньше — узкая полоска, чтобы не занимать экран */
function Strip(props: { left: number }) {
  const { d, h, m, s } = split(props.left);
  return (
    <div className="mt-5 flex items-center gap-3 rounded-2xl bg-surface py-2.5 pr-3 pl-2.5 shadow-[0_6px_18px_rgb(74_52_36/0.1)]">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-hot text-hot-ink">
        <Gift size={22} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[15px] font-bold text-ink">
          −{PROMO.percent}% {PROMO.title}
        </p>
        <p className="text-[12px] whitespace-nowrap text-dim">
          сгорит через{" "}
          <b className="font-semibold text-coffee tabular-nums">
            {d > 0 && `${d} ${plural(d, ["день", "дня", "дней"])} `}
            <Roll text={`${pad(h)}:${pad(m)}:${pad(s)}`} />
          </b>
        </p>
      </div>
    </div>
  );
}

/** Подарок: закрыт — ползунок; только что открыт — плашка и таймер; открыт раньше — полоска; сгорел или использован — пусто */
export function Promo(props: { me: Me; onOpened: (promoAt: number) => void }) {
  const { promoAt, promoUsed } = props.me;
  // ?fresh — только в разработке: показать «только что открытый» вид для снимков
  const [fresh, setFresh] = useState(() => import.meta.env.DEV && location.search.includes("fresh"));
  const left = useLeft(promoAt ? promoEnd(promoAt) : 0);
  if (promoUsed) return null;
  if (promoAt && left <= 0) return null;
  if (promoAt && !fresh) return <Strip left={left} />;

  const unlock = () => {
    setFresh(true);
    confetti();
    // Время открытия ставит сервер; не ответил — считаем от сейчас, при следующем входе возьмём серверное
    props.onOpened(Date.now());
    api.promoOpen().then((r) => props.onOpened(r.promoAt), () => {});
  };
  const open = !!promoAt;
  return (
    <section className="mt-5 rounded-2xl bg-surface p-5 text-center text-ink shadow-[0_8px_24px_rgb(74_52_36/0.12)]" aria-label="Подарок: скидка на первую аренду">
      <div className={`mx-auto mb-4 grid size-20 place-items-center rounded-full bg-coffee-soft text-coffee ${open ? "" : "gift-wiggle"}`}>
        <Gift size={38} strokeWidth={1.8} />
      </div>
      <h2 className="font-display text-[21px] leading-tight font-bold text-espresso">{open ? "Подарок ваш!" : "Вам подарок к первой аренде"}</h2>
      <p className="mx-auto mt-2 max-w-[290px] text-[14px] text-dim">
        {open ? "Скидка учтётся в заявке сама. Успейте до конца таймера." : `Откройте и заберите скидку. После открытия она действует ${PROMO.days} ${plural(PROMO.days, ["день", "дня", "дней"])}.`}
      </p>
      {open ? (
        <div className="screen-in mt-5">
          <Badge />
          <div className="mt-5 mb-2 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-coffee">
            <Flame size={16} aria-hidden /> Сгорит через
          </div>
          <Countdown left={left} />
        </div>
      ) : (
        <Slider onUnlock={unlock} />
      )}
    </section>
  );
}
