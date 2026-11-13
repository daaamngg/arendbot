import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronLeft, Heart, KeyRound, LoaderCircle, Minus, Plus, Search, ShieldCheck } from "lucide-react";
import type { BookingStatus, ListingStatus } from "../../../shared/types.ts";
import { api } from "../lib/api.ts";
import { hasNativeBack, inMax, requestContact } from "../lib/max.ts";

export type Tab = "search" | "trips" | "host" | "admin";

// Каркас: тонкая шапка, снизу панель вкладок с иконками (как в обычных приложениях — палец достаёт).
// На вложенных экранах панели нет, вместо неё «Назад». Нижние кнопки экранов (Sticky) встают над панелью
export function Shell(props: { children: ReactNode; tab: Tab; onTab: (t: Tab) => void; admin: boolean; owner?: boolean; unread?: number; onBack?: () => void; title?: string; onLogo?: () => void }) {
  const taps = useRef<number[]>([]);
  const logoTap = () => {
    if (!props.onLogo) return;
    const t = Date.now();
    taps.current = [...taps.current.filter((x) => t - x < 2000), t];
    if (taps.current.length >= 5) {
      taps.current = [];
      props.onLogo();
    }
  };
  const tabs: { id: Tab; title: string; icon: typeof Search }[] = [
    { id: "search", title: "Поиск", icon: Search },
    { id: "trips", title: "Моё", icon: Heart },
    { id: "host", title: "Сдать", icon: KeyRound },
    // Главный видит «Админ», модератор — «Модератор»
    ...(props.admin ? [{ id: "admin" as Tab, title: props.owner ? "Админ" : "Модератор", icon: ShieldCheck }] : []),
  ];
  const ownBack = props.onBack && !hasNativeBack();
  const nav = !props.onBack;
  const vars = {
    "--nav": nav ? "58px" : "0px",
    // С панелью вкладок отступ под «чёлку» снизу берёт панель; без неё — нижняя кнопка экрана
    "--sticky-pb": nav ? "12px" : "max(14px, env(safe-area-inset-bottom))",
  } as CSSProperties;
  return (
    <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col" style={vars}>
      <header className="sticky top-0 z-20 flex h-13 items-center gap-1 border-b border-line bg-bg px-4">
        {ownBack && (
          <button onClick={props.onBack} className="-ml-2 grid size-10 place-items-center rounded-full text-ink" aria-label="Назад">
            <ChevronLeft size={24} />
          </button>
        )}
        {props.title ? (
          <div className="truncate text-[17px] font-bold text-ink">{props.title}</div>
        ) : (
          <div className="flex items-center gap-2" onClick={logoTap}>
            <span className="grid size-7 place-items-center rounded-lg bg-accent text-white" aria-hidden>
              <KeyRound size={16} strokeWidth={2.4} />
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-bold text-ink">Посуточно</span>
              <span className="block text-[12px] text-dim">Самара и область</span>
            </span>
          </div>
        )}
      </header>
      <main className="flex flex-1 flex-col px-4 pt-4 pb-6">{props.children}</main>
      {nav && (
        <nav className="sticky bottom-0 z-20 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }} aria-label="Разделы">
          {tabs.map((t) => {
            const on = props.tab === t.id;
            return (
              <button key={t.id} onClick={() => props.onTab(t.id)} aria-current={on ? "page" : undefined} className={`flex h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${on ? "text-accent" : "text-dim"}`}>
                <span className="relative">
                  <t.icon size={22} strokeWidth={on ? 2.4 : 1.9} />
                  {t.id === "trips" && !!props.unread && (
                    <span className="absolute -top-1.5 -right-2.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white" aria-label={`непрочитанных: ${props.unread}`}>
                      {props.unread}
                    </span>
                  )}
                </span>
                {t.title}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

export function Sticky(props: { children: ReactNode }) {
  return <div className="sticky bottom-[var(--nav)] z-10 -mx-4 mt-auto border-t border-line bg-bg px-4 pt-3 pb-[var(--sticky-pb)]">{props.children}</div>;
}

export function H1(props: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="text-[24px] leading-tight font-bold tracking-[-0.01em] text-ink text-balance">{props.children}</h1>
      {props.sub && <p className="mt-1 text-[15px] text-dim">{props.sub}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="grid flex-1 place-items-center py-16 text-dim">
      <LoaderCircle className="animate-spin" size={26} />
    </div>
  );
}

export function Stepper(props: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" className="btn btn-line size-11 min-h-0 p-0" disabled={props.value <= props.min} onClick={() => props.onChange(props.value - 1)} aria-label={`Меньше: ${props.label}`}>
        <Minus size={18} />
      </button>
      <span className="min-w-8 text-center text-[17px] font-semibold text-ink tabular-nums">{props.value}</span>
      <button type="button" className="btn btn-line size-11 min-h-0 p-0" disabled={props.value >= props.max} onClick={() => props.onChange(props.value + 1)} aria-label={`Больше: ${props.label}`}>
        <Plus size={18} />
      </button>
    </div>
  );
}

const LISTING_STATUS: Record<ListingStatus, [string, string]> = {
  draft: ["Черновик", "text-dim bg-surface-2"],
  pending: ["На проверке", "text-warn bg-[#f6ecd9]"],
  active: ["В поиске", "text-ok bg-[#e2efe3]"],
  rejected: ["Вернули на доработку", "text-bad bg-[#f5e1dd]"],
  paused: ["Снято с показа", "text-dim bg-surface-2"],
  blocked: ["Снято модератором", "text-bad bg-[#f5e1dd]"],
  deleted: ["Удалено", "text-dim bg-surface-2"],
};

const BOOKING_STATUS: Record<BookingStatus, [string, string]> = {
  requested: ["Ждёт ответа хозяина", "text-warn bg-[#f6ecd9]"],
  confirmed: ["Подтверждена", "text-ok bg-[#e2efe3]"],
  declined: ["Хозяин отказал", "text-dim bg-surface-2"],
  expired: ["Хозяин не ответил", "text-dim bg-surface-2"],
  cancelled: ["Отменена", "text-dim bg-surface-2"],
  noshow: ["Гость не приехал", "text-bad bg-[#f5e1dd]"],
};

export function Badge(props: { listing?: ListingStatus; booking?: BookingStatus }) {
  const [text, cls] = props.listing ? LISTING_STATUS[props.listing] : BOOKING_STATUS[props.booking!];
  return <span className={`inline-flex h-6 items-center rounded-md px-2 text-[12px] font-semibold ${cls}`}>{text}</span>;
}

export const normalizePhone = (raw: string) => {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && (d[0] === "7" || d[0] === "8")) return `+7${d.slice(1)}`;
  if (d.length === 10) return `+7${d}`;
  return null;
};

export const phoneText = (p: string) => p.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7 $1 $2-$3-$4");

/**
 * Номер + согласие (152-ФЗ: отдельная галочка, не отмечена заранее). В MAX номер подставляет окно
 * «Поделиться номером», в браузере — вводится руками. Нужен и гостю (бронь), и хозяину (объявление)
 */
export function PhoneGate(props: { why: string; onDone: (phone: string) => void }) {
  const [consent, setConsent] = useState(false);
  const [manual, setManual] = useState(!inMax());
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (phone: string, contact?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api.phone(phone, contact);
      props.onDone(phone);
    } catch {
      setError("Не получилось сохранить номер. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const [asking, setAsking] = useState(false);
  const share = async () => {
    setAsking(true);
    const c = await requestContact();
    setAsking(false);
    const phone = c ? normalizePhone(c.phone) : null;
    if (phone) save(phone, c);
    else setManual(true);
  };

  const typed = normalizePhone(raw);
  return (
    <section className="card p-4">
      <h2 className="text-[17px] font-bold text-ink">Нужен номер телефона</h2>
      <p className="mt-1 text-[14px] text-dim">{props.why}</p>
      <label className="mt-3 flex cursor-pointer items-start gap-3">
        <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border-2 ${consent ? "border-accent bg-accent text-white" : "border-dim bg-surface"}`} aria-hidden>
          {consent && <Check size={16} strokeWidth={3} />}
        </span>
        <input
          type="checkbox"
          className="sr-only"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            if (e.target.checked && !manual) share();
          }}
        />
        <span className="text-[14px] leading-snug">Согласен на обработку персональных данных по политике площадки</span>
      </label>
      {/* Ждём окно MAX — видно, что идёт работа; и всегда можно ввести номер руками */}
      {asking && !manual && (
        <div className="mt-3 flex items-center justify-between gap-3 text-[14px] text-dim">
          <span className="flex items-center gap-2">
            <LoaderCircle className="animate-spin" size={16} /> Ждём номер из MAX…
          </span>
          <button className="font-semibold text-accent" onClick={() => setManual(true)}>
            Ввести вручную
          </button>
        </div>
      )}
      {busy && !manual && (
        <p className="mt-3 flex items-center gap-2 text-[14px] text-dim">
          <LoaderCircle className="animate-spin" size={16} /> Сохраняем…
        </p>
      )}
      {!manual && !asking && !busy && consent && (
        <button className="mt-3 text-[14px] font-semibold text-accent" onClick={() => setManual(true)}>
          Ввести номер вручную
        </button>
      )}
      {manual && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed && consent) save(typed);
          }}
        >
          <input className="field min-w-0 flex-1" type="tel" inputMode="tel" placeholder="+7 900 000-00-00" value={raw} onChange={(e) => setRaw(e.target.value)} aria-label="Номер телефона" />
          <button className="btn btn-main shrink-0" disabled={!consent || !typed || busy}>
            {busy ? <LoaderCircle className="animate-spin" size={18} /> : "Готово"}
          </button>
        </form>
      )}
      {!manual && consent && (
        <button className="btn btn-main mt-3 w-full" onClick={share} disabled={busy}>
          Поделиться номером
        </button>
      )}
      {error && <p className="mt-2 text-[14px] text-bad">{error}</p>}
    </section>
  );
}

/** Самые нужные города — крупными плитками сверху шторки */
const TOP_CITIES = ["Самара", "Тольятти", "Сызрань", "Новокуйбышевск", "Жигулёвск", "Чапаевск"];

/**
 * Выбор города: кнопка-строка, по нажатию — шторка снизу. Сверху поиск, ниже крупные плитки главных городов,
 * под ними остальные посёлки списком. Вместо системного «барабана», который на телефоне неудобный и длинный
 */
export function CityPicker(props: { value: string; onChange: (v: string) => void; options: string[]; allLabel?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const pick = (v: string) => {
    props.onChange(v);
    setOpen(false);
    setQ("");
  };
  const needle = q.trim().toLowerCase();
  const found = props.options.filter((c) => !needle || c.toLowerCase().includes(needle));
  const top = TOP_CITIES.filter((c) => found.includes(c));
  const rest = found.filter((c) => !TOP_CITIES.includes(c));
  return (
    <>
      <button type="button" className={props.className ?? "flex min-w-0 flex-1 items-center justify-between gap-2 py-1 text-left"} onClick={() => setOpen(true)}>
        <span className="truncate text-[15px] font-semibold text-ink">{props.value || props.allLabel || "Выбрать"}</span>
        <ChevronDown size={16} className="shrink-0 text-dim" aria-hidden />
      </button>
      {/* Шторка — в конце страницы (портал): внутри строки-«label» анкеты нажатие по городу открывало бы шторку снова */}
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Выбор города">
          <div className="flex max-h-[80dvh] w-full max-w-[560px] flex-col rounded-t-2xl bg-surface pb-[max(12px,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" aria-hidden />
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className="text-[17px] font-bold text-ink">Город</span>
              <button className="text-[14px] font-semibold text-dim" onClick={() => setOpen(false)}>
                Закрыть
              </button>
            </div>
            <div className="px-4 pb-3">
              <div className="flex items-center gap-2 rounded-xl border border-line bg-bg px-3">
                <Search size={16} className="shrink-0 text-dim" />
                <input className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] outline-none" placeholder="Найти город или посёлок" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <div className="overflow-y-auto px-4">
              {props.allLabel && !needle && (
                <button className={`mb-2 flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-[15px] font-semibold ${!props.value ? "border-accent bg-accent-soft text-accent" : "border-line text-ink"}`} onClick={() => pick("")}>
                  {props.allLabel}
                  {!props.value && <Check size={18} />}
                </button>
              )}
              {top.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {top.map((c) => (
                    <button key={c} className={`flex items-center justify-between rounded-xl border px-3 py-3 text-left text-[15px] font-semibold ${props.value === c ? "border-accent bg-accent-soft text-accent" : "border-line bg-bg text-ink"}`} onClick={() => pick(c)}>
                      <span className="truncate">{c}</span>
                      {props.value === c && <Check size={16} className="shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
              {rest.length > 0 && (
                <ul className="mt-3 divide-y divide-line">
                  {rest.map((c) => (
                    <li key={c}>
                      <button className={`flex w-full items-center justify-between py-3 text-left text-[15px] ${props.value === c ? "font-semibold text-accent" : "text-ink"}`} onClick={() => pick(c)}>
                        {c}
                        {props.value === c && <Check size={16} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {found.length === 0 && <p className="py-6 text-center text-[14px] text-dim">Не нашли «{q}». Сейчас площадка работает в Самарской области.</p>}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Обложка фото. Горизонтальное фото заполняет рамку как обычно. Вертикальное или квадратное
 * (снято телефоном «стоя») не обрезаем — показываем целиком, а пустые края закрываем размытой копией.
 * Так в поиске видно всю квартиру, а не кусок стены крупным планом
 */
export function Cover(props: { src: string; alt?: string; className?: string; lazy?: boolean }) {
  const [tall, setTall] = useState(false);
  return (
    <div className={`relative overflow-hidden bg-surface-2 ${props.className ?? ""}`}>
      {tall && <img src={props.src} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-70 blur-xl" />}
      <img
        src={props.src}
        alt={props.alt ?? ""}
        loading={props.lazy ? "lazy" : undefined}
        onLoad={(e) => setTall(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight) < 1.15)}
        className={`relative size-full ${tall ? "object-contain" : "object-cover"}`}
      />
    </div>
  );
}
