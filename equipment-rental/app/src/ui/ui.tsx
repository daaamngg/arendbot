import { useState, type ReactNode } from "react";
import { Check, ChevronLeft, CloudFog, Disc3, Drill, Fan, Hammer, LoaderCircle, Phone, Sparkles, SquareSplitHorizontal, Wind } from "lucide-react";
import { PHONE, PHONE_HREF } from "../../../shared/catalog.ts";
import type { Item } from "../../../shared/types.ts";
import { api } from "../lib/api.ts";
import { inMax, requestContact } from "../lib/max.ts";

export type Tab = "catalog" | "my" | "owner";

/** Заголовок шага заявки: номер в кружке, выполненный шаг — галочка на кофейном */
export function Step(props: { n: number; title: string; done?: boolean; hint?: string }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span
        className={`grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold transition-colors ${props.done ? "bg-coffee text-on-coffee" : "border-2 border-line text-dim"}`}
        aria-hidden
      >
        {props.done ? <Check size={15} strokeWidth={3} /> : props.n}
      </span>
      <div className="min-w-0 pt-0.5">
        <h2 className="text-[17px] leading-tight font-bold text-ink">{props.title}</h2>
        {props.hint && <p className="mt-0.5 text-[13px] text-dim">{props.hint}</p>}
      </div>
    </div>
  );
}

/** Каркас: шапка (или «Назад» на вложенном экране), содержимое, вкладки снизу */
export function Shell(props: { tab: Tab; onTab: (t: Tab) => void; owner: boolean; title?: string; onBack?: () => void; children: ReactNode }) {
  const tabs: [Tab, string][] = [
    ["catalog", "Оборудование"],
    ["my", "Мои заявки"],
    ...(props.owner ? ([["owner", "Управление"]] as [Tab, string][]) : []),
  ];
  return (
    <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-bg/95 px-4 backdrop-blur">
        {props.onBack ? (
          <button className="-ml-2 flex items-center gap-1 rounded-full py-2 pr-3 pl-1 font-semibold text-ink" onClick={props.onBack} aria-label="Назад">
            <ChevronLeft size={22} /> {props.title}
          </button>
        ) : (
          <span className="font-display text-[18px] font-bold text-espresso">Домашний эксперт</span>
        )}
        <a className="ml-auto grid size-10 place-items-center rounded-full text-coffee" href={PHONE_HREF} aria-label={`Позвонить ${PHONE}`}>
          <Phone size={20} />
        </a>
      </header>
      <main className="flex flex-1 flex-col px-4 pt-4 pb-6">{props.children}</main>
      {!props.onBack && (
        <nav className={`sticky bottom-0 z-20 grid border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur ${tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
          {tabs.map(([id, title]) => (
            <button key={id} onClick={() => props.onTab(id)} aria-current={props.tab === id ? "page" : undefined} className={`h-14 text-[13px] font-semibold ${props.tab === id ? "text-coffee" : "text-dim"}`}>
              {title}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

export const Spinner = () => (
  <div className="grid flex-1 place-items-center py-16 text-dim">
    <LoaderCircle className="animate-spin" size={26} />
  </div>
);

/** Значок оборудования, пока нет фото */
const ICONS = { vacuum: Sparkles, fan: Fan, steam: CloudFog, window: SquareSplitHorizontal, ozone: Wind, hammer: Hammer, drill: Drill, grinder: Disc3 };
/** Значок оборудования в круге — для плиток каталога, пока у позиции нет фото */
export function ItemIcon(props: { item: Item; className?: string; size?: number }) {
  const Icon = ICONS[props.item.icon];
  return (
    <span className={`grid place-items-center rounded-full bg-coffee-soft text-coffee ${props.className ?? ""}`} aria-hidden>
      <Icon size={props.size ?? 30} strokeWidth={1.6} />
    </span>
  );
}
export function ItemPicture(props: { item: Item; className?: string; size?: number; small?: boolean }) {
  const Icon = ICONS[props.item.icon];
  const src = (props.small && props.item.photos[1]) || props.item.photos[0];
  return src ? (
    <img src={src} alt="" className={`bg-white object-contain ${props.className ?? ""}`} loading="lazy" />
  ) : (
    <div className={`grid place-items-center rounded-2xl bg-coffee-soft text-coffee ${props.className ?? ""}`} aria-hidden>
      <Icon size={props.size ?? 34} strokeWidth={1.6} />
    </div>
  );
}

export const normalizePhone = (raw: string) => {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && (d[0] === "7" || d[0] === "8") ? d.slice(1) : d.length === 10 ? d : "";
  return ten ? `+7${ten}` : null;
};
export const phoneText = (p: string) => p.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7 $1 $2-$3-$4");

/** Номер телефона: одной кнопкой из MAX («Поделиться номером») или руками; согласие на обработку отдельно */
export function PhoneGate(props: { onDone: (phone: string) => void; step?: number }) {
  const [consent, setConsent] = useState(false);
  const [manual, setManual] = useState(!inMax());
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (phone: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.phone(phone);
      props.onDone(phone);
    } catch {
      setError("Не получилось сохранить номер. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    const c = await requestContact();
    const phone = c ? normalizePhone(c.phone) : null;
    if (phone) save(phone);
    else setManual(true);
  };
  const typed = normalizePhone(raw);
  return (
    <section className="card p-4">
      {props.step ? (
        <Step n={props.step} title="Номер для связи" hint="По нему владелец подтвердит заявку" />
      ) : (
        <>
          <h2 className="text-[17px] font-bold text-ink">Номер для связи</h2>
          <p className="mt-1 text-[14px] text-dim">По нему владелец подтвердит заявку и договорится о доставке.</p>
        </>
      )}
      <label className="mt-1 flex cursor-pointer items-start gap-3">
        <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border-2 ${consent ? "border-coffee bg-coffee text-on-coffee" : "border-dim bg-surface"}`} aria-hidden>
          {consent && <Check size={16} strokeWidth={3} />}
        </span>
        <input type="checkbox" className="sr-only" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span className="text-[14px] leading-snug">Согласен на обработку персональных данных</span>
      </label>
      {manual ? (
        <div className="mt-3 flex gap-2">
          <input className="field flex-1" inputMode="tel" placeholder="+7 900 000-00-00" value={raw} onChange={(e) => setRaw(e.target.value)} aria-label="Номер телефона" />
          <button className="btn btn-main px-5" disabled={!consent || !typed || busy} onClick={() => typed && save(typed)}>
            Готово
          </button>
        </div>
      ) : (
        <button className="btn btn-main mt-3 w-full" disabled={!consent || busy} onClick={share}>
          Поделиться номером
        </button>
      )}
      {error && <p className="mt-2 text-[14px] text-bad">{error}</p>}
    </section>
  );
}

/** Статус заявки — плашкой */
export function Status(props: { status: string }) {
  const map: Record<string, [string, string]> = {
    requested: ["Ждёт ответа", "bg-coffee-soft text-coffee"],
    confirmed: ["Подтверждена", "bg-ok-soft text-ok"],
    declined: ["Отклонена", "bg-surface-2 text-dim"],
    cancelled: ["Отменена", "bg-surface-2 text-dim"],
    expired: ["Без ответа", "bg-surface-2 text-dim"],
  };
  const [t, c] = map[props.status] ?? [props.status, "bg-surface-2 text-dim"];
  return <span className={`inline-block shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap ${c}`}>{t}</span>;
}
