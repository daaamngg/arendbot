import { useEffect, useState } from "react";
import { CalendarDays, ChevronRight, Flag, History, Home, Lock, Search, ShieldCheck, Trash2, UserCog, UserMinus, UserPlus, Users, LifeBuoy } from "lucide-react";
import { guestsText, nightsFrom, rangeText, rub } from "../../../shared/dates.ts";
import type { Listing, SupportTicket } from "../../../shared/types.ts";
import { api, errorText, type AdminBookingRow, type AdminReviewRow, type AdminListing, type AdminStats, type AdminUser, type AuditRow, type ComplaintRow, type HostApplicationRow, type StaffRow } from "../lib/api.ts";
import { useLive } from "../lib/live.ts";
import { ask, askText, tell } from "../ui/dialog.tsx";
import { Badge, H1, Spinner, normalizePhone, phoneText } from "../ui/ui.tsx";

// Админка площадки. Модераторы проверяют объявления и жалобы, смотрят людей и журнал.
// Главный (Сергей) ещё и собирает команду: назначает и снимает модераторов.

type Section = "apps" | "bookings" | "complaints" | "review" | "support" | "listings" | "people" | "team" | "log";

// Модератор видит только то, что нужно проверять. Главный — всё: брони, объявления, люди, команда, история
const SECTIONS: { id: Section; title: string; icon: typeof Flag; owner?: boolean }[] = [
  { id: "review", title: "Проверка", icon: ShieldCheck },
  { id: "apps", title: "Заявки", icon: UserPlus },
  { id: "complaints", title: "Жалобы", icon: Flag },
  { id: "support", title: "Обращения", icon: LifeBuoy },
  { id: "bookings", title: "Брони", icon: CalendarDays, owner: true },
  { id: "listings", title: "Объявления", icon: Home, owner: true },
  { id: "people", title: "Люди", icon: Users, owner: true },
  { id: "team", title: "Команда", icon: UserCog, owner: true },
  { id: "log", title: "История", icon: History, owner: true },
];

/** Последние данные каждого раздела — чтобы переключение было мгновенным, без «загрузки» */
const memo = new Map<string, unknown>();
function useCached<T>(key: string) {
  const [v, setV] = useState<T | null>(() => (memo.get(key) as T | undefined) ?? null);
  const set = (x: T | null | ((prev: T | null) => T | null)) =>
    setV((prev) => {
      const next = typeof x === "function" ? (x as (p: T | null) => T | null)(prev) : x;
      memo.set(key, next);
      return next;
    });
  return [v, set] as const;
}

const when = (ms: number) => new Date(ms).toLocaleString("ru-RU", { timeZone: "Europe/Samara", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function AdminScreen(props: { owner: boolean; onOpen: (listingId: string) => void }) {
  const [section, setSection] = useState<Section>("review");
  const sections = SECTIONS.filter((x) => !x.owner || props.owner);
  const [stats, setStats] = useCached<AdminStats>("stats");
  const [msg, setMsg] = useState<string | null>(null);
  useLive(() => api.stats().then(setStats), 30000);

  /** Выполнить действие и показать итог одной строкой */
  const act = async (fn: () => Promise<unknown>, done: string, after?: () => void) => {
    try {
      await fn();
      setMsg(done);
      after?.();
      api.stats().then(setStats, () => {});
    } catch (e) {
      setMsg(errorText(e));
    }
  };

  return (
    <>
      <H1>{props.owner ? "Админ" : "Модератор"}</H1>
      {/* Цифры площадки — три одинаковые плашки */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        {(
          [
            ["в поиске", stats?.listings.active ?? 0],
            ["брони, 7 дн.", stats?.bookingsWeek ?? 0],
            ["людей", stats?.users ?? 0],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="card flex flex-col items-center justify-center px-2 py-3 text-center">
            <div className="text-[22px] leading-none font-bold text-ink tabular-nums">{stats ? n : "–"}</div>
            <div className="mt-1.5 text-[12px] leading-tight whitespace-nowrap text-dim">{label}</div>
          </div>
        ))}
      </div>
      {/* Разделы — плитками, всё видно сразу, без прокрутки вбок. Цифра в углу — сколько ждёт решения */}
      <div className={`mb-5 grid gap-2 ${sections.length === 4 ? "grid-cols-4" : "grid-cols-3"}`} role="tablist">
        {sections.map((s) => {
          const Icon = s.icon;
          const on = section === s.id;
          const count = s.id === "complaints" ? stats?.openComplaints : s.id === "apps" ? stats?.pendingHosts : s.id === "review" ? stats?.toReview : s.id === "support" ? stats?.openTickets : 0;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={on}
              onClick={() => {
                setSection(s.id);
                setMsg(null);
              }}
              className={`relative flex flex-col items-center gap-1.5 rounded-xl border px-1 pt-3 pb-2.5 text-[12px] font-semibold transition-colors ${
                on ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink active:bg-surface-2"
              }`}
            >
              <Icon size={20} aria-hidden className={on ? "text-white" : "text-accent"} />
              <span className="leading-none">{s.title}</span>
              {count ? (
                <span className={`absolute top-1.5 right-1.5 min-w-[18px] rounded-full px-1 text-[11px] leading-[18px] font-bold tabular-nums ${on ? "bg-white text-accent" : s.id === "complaints" ? "bg-bad text-white" : "bg-accent text-white"}`}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {msg && <p className="mb-3 rounded-lg bg-accent-soft p-3 text-[14px] text-ink">{msg}</p>}

      {section === "apps" && <Applications act={act} />}
      {section === "bookings" && props.owner && <Bookings act={act} />}
      {section === "complaints" && <Complaints act={act} owner={props.owner} onOpen={props.onOpen} />}
      {section === "review" && <Review act={act} />}
      {section === "listings" && <AllListings act={act} />}
      {section === "people" && <People act={act} />}
      {section === "support" && <Support act={act} />}
      {section === "team" && <Team act={act} owner={props.owner} />}
      {section === "log" && <Log />}
    </>
  );
}

type Act = (fn: () => Promise<unknown>, done: string, after?: () => void) => Promise<void>;

// --- Проверка: жалобы сверху, ниже непросмотренные и ждущие объявления ----------------------

const REASONS: [string, string][] = [
  ["photos", "Фото"],
  ["data", "Данные"],
  ["fraud", "Обман"],
  ["other", "Другое"],
];

// --- Заявки «хочу сдавать» ---------------------------------------------------------------

function Applications(props: { act: Act }) {
  const [list, setList] = useCached<HostApplicationRow[]>("apps");
  const load = () => api.applications().then((r) => setList(r.applications), () => setList((x) => x ?? []));
  // Новое приходит само, без перезагрузки
  useLive(load, 15000);
  if (!list) return <Spinner />;
  if (!list.length) return <p className="text-dim">Новых заявок нет. Заявки приходят и в чат с ботом, с кнопками.</p>;
  return (
    <ul className="space-y-3">
      {list.map((a) => (
        <li key={a.id} className="card p-4 text-[14px]">
          <div className="text-[16px] font-semibold text-ink">{a.name}</div>
          <div className="text-dim">
            {a.phone ? phoneText(a.phone) : ""} · {a.city}
          </div>
          {a.about && <p className="mt-2">{a.about}</p>}
          <div className="mt-1 text-[12px] text-dim">подана {when(a.at)}</div>
          {/* Подсказки бота: решаете вы, но проверять всё вручную не нужно */}
          <div className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${a.hints.flags.length ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}>
            {a.hints.flags.length ? <>Бот советует проверить: {a.hints.flags.join("; ")}</> : "Бот ничего подозрительного не нашёл"}
            {a.hints.good.length > 0 && <div className="mt-0.5 text-dim">В пользу: {a.hints.good.join("; ")}</div>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn btn-main" onClick={() => props.act(() => api.decideApplication(a.id, true), "Заявка принята, человек может размещать объявления.", load)}>
              Принять
            </button>
            <button
              className="btn btn-line"
              onClick={async () => {
                const note = await askText("Причина отказа", "Заявка не подходит под правила площадки.", { text: "Человек её увидит.", ok: "Отказать", danger: true });
                if (note !== null) props.act(() => api.decideApplication(a.id, false, note), "Отказано, человеку отправлен ответ.", load);
              }}
            >
              Отказать
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- Жалобы гостей ---------------------------------------------------------------------

function Complaints(props: { act: Act; owner: boolean; onOpen: (id: string) => void }) {
  const [complaints, setComplaints] = useCached<ComplaintRow[]>("complaints");
  const load = () => api.pending().then((r) => setComplaints(r.complaints), () => setComplaints((x) => x ?? []));
  // Новое приходит само, без перезагрузки
  useLive(load, 15000);
  if (!complaints) return <Spinner />;
  if (!complaints.length) return <p className="text-dim">Жалоб нет.</p>;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[17px] font-bold text-ink">
          <Flag size={17} /> Жалобы гостей · {complaints.length}
        </h2>
        <button
          className="text-[14px] font-semibold text-dim"
          onClick={async () => (await ask("Очистить все жалобы?", { text: "Они уйдут из списка и не будут считаться против хозяев.", ok: "Очистить" })) && props.act(() => api.clearComplaints(), "Жалобы очищены.", load)}
        >
          Очистить все
        </button>
      </div>
      <ul className="space-y-3">
            {complaints.map((c) => (
              <li key={c.id} className="card p-3.5 text-[14px]">
                {/* Сначала посмотреть само объявление — по названию открывается как у гостя */}
                <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => props.onOpen(c.listingId)}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{c.title}</span>
                    <span className="block text-[13px] text-bad">{c.reasonTitle}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-accent">
                    Открыть <ChevronRight size={16} />
                  </span>
                </button>
                {c.text && <p className="mt-1.5 text-text">«{c.text}»</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-ink" onClick={() => props.act(() => api.resolveComplaint(c.id, "hide"), "Объявление скрыто.", load)}>
                    Скрыть
                  </button>
                  <button className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-ink" onClick={() => props.act(() => api.resolveComplaint(c.id, "ok"), "Жалоба закрыта.", load)}>
                    Всё ок
                  </button>
                  <button className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-dim" onClick={() => props.act(() => api.resolveComplaint(c.id, "dismiss"), "Жалоба удалена.", load)}>
                    Ложная
                  </button>
                  {props.owner && (
                    <button
                      className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-bad"
                      onClick={async () => (await ask("Заблокировать хозяина?", { text: "Все его объявления снимутся, гостям придёт отмена.", ok: "Заблокировать", danger: true })) && props.act(() => api.resolveComplaint(c.id, "ban"), "Хозяин заблокирован.", load)}
                    >
                      Бан
                    </button>
                  )}
                </div>
              </li>
            ))}
      </ul>
    </section>
  );
}

// --- Проверка: новые и изменённые объявления ---------------------------------------------

function Review(props: { act: Act }) {
  const [list, setList] = useCached<(Listing & { title: string; held: string[] })[]>("review");
  const [reviews, setReviews] = useCached<AdminReviewRow[]>("reviews");
  const load = () => {
    api.pending().then((r) => setList(r.listings), () => setList((x) => x ?? []));
    api.adminReviews().then((r) => setReviews(r.reviews), () => {});
  };
  // Новое приходит само, без перезагрузки
  useLive(load, 15000);
  if (!list) return <Spinner />;
  return (
    <>
      {reviews && reviews.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-[15px] font-bold text-ink">Отзывы на проверке</h2>
          <ul className="space-y-3">
            {reviews.map((r) => (
              <li key={r.id} className="card px-4 py-3.5 text-[14px]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{r.title}</div>
                    <div className="text-dim">{r.guestName ?? "Гость"}</div>
                  </div>
                  <span className="shrink-0 text-star" aria-label={`Оценка ${r.stars} из 5`}>
                    {"★".repeat(r.stars)}
                    <span className="text-line">{"★".repeat(5 - r.stars)}</span>
                  </span>
                </div>
                {r.text && <p className="mt-2 text-ink">«{r.text}»</p>}
                {r.held?.length ? <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">Смотритель придержал: {r.held.join(", ")}</p> : null}
                {r.disputed && <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-ink">Хозяин оспаривает: «{r.disputed}»</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-accent" onClick={() => props.act(() => api.adminReview(r.listingId, r.id, true), r.held?.length ? "Отзыв засчитан." : "Отзыв оставлен.", load)}>
                    {r.held?.length ? "Засчитать" : "Оставить"}
                  </button>
                  <button className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-bad" onClick={() => props.act(() => api.adminReview(r.listingId, r.id, false), "Отзыв убран.", load)}>
                    Убрать
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {list.length === 0 && <p className="text-dim">{reviews?.length ? "Объявления все проверены." : "Всё проверено."}</p>}
      <ul className="space-y-4">
        {list.map((l) => {
          const live = l.status === "active";
          return (
            <li key={l.id} className="card overflow-hidden">
              <div className="flex snap-x gap-1 overflow-x-auto">
                {l.photos.map((p) => (
                  <img key={p.url} src={p.url} alt="" className="h-36 w-48 shrink-0 snap-start object-cover" />
                ))}
              </div>
              <div className="p-4 text-[14px]">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[16px] font-semibold text-ink">{l.title}</div>
                  <Badge listing={l.status} />
                </div>
                {l.held.length > 0 && <p className="mt-1 font-semibold text-warn">Бот отправил на проверку: {l.held.join(", ")}</p>}
                <div className="text-dim">
                  {l.locality}
                  {l.district ? `, ${l.district}` : ""}, {l.address}
                </div>
                <div className="mt-1">
                  {guestsText(l.guests)}, будни {rub(l.priceWeekday)}, выходные {rub(l.priceWeekend)}, {nightsFrom(l.minNights)}
                </div>
                <p className="mt-2 whitespace-pre-line">{l.description}</p>
                <button className="btn btn-main mt-3 w-full" onClick={() => props.act(() => api.moderate(l.id, true), live ? "Отмечено как проверенное." : "Одобрено, объявление в поиске.", load)}>
                  {live ? "Всё хорошо" : "Одобрить"}
                </button>
                <div className="mt-2 text-[13px] text-dim">{live ? "Скрыть из поиска, причина:" : "Отклонить, причина:"}</div>
                <div className="mt-1 grid grid-cols-4 gap-2">
                  {REASONS.map(([k, t]) => (
                    <button key={k} className="btn btn-line min-h-10 px-1 text-[13px]" onClick={() => props.act(() => api.moderate(l.id, false, k), "Готово, хозяин получил причину.", load)}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// --- Все объявления: фильтр по статусу, поиск, скрыть или вернуть -------------------------

const STATUS_FILTER: [string, string][] = [
  ["", "Все"],
  ["active", "В поиске"],
  ["pending", "Ждут"],
  ["blocked", "Сняты"],
  ["rejected", "Возвращены"],
  ["paused", "На паузе"],
  ["deleted", "Удалённые"],
];

function AllListings(props: { act: Act }) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [list, setList] = useCached<AdminListing[]>("listings");
  const load = () => api.adminListings(status, q).then((r) => setList(r.listings), () => setList([]));
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, q]);
  return (
    <>
      <SearchField value={q} onChange={setQ} placeholder="Город, улица или номер объявления" />
      <div className="-mx-4 my-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {STATUS_FILTER.map(([k, t]) => (
          <button key={k} className="chip shrink-0" aria-pressed={status === k} onClick={() => setStatus(k)}>
            {t}
          </button>
        ))}
      </div>
      {!list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="text-dim">Ничего не найдено.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {list.map((l) => (
            <li key={l.id} className="flex gap-3 p-3 text-[14px]">
              <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2 text-dim">{l.photo ? <img src={l.photo} alt="" className="size-full object-cover" /> : <Home size={20} aria-hidden />}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-ink">{l.title}</div>
                <div className="truncate text-dim">{[l.locality, l.address].filter(Boolean).join(", ")}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Badge listing={l.status} />
                  {l.status === "active" && l.botChecked && <span className="text-[12px] font-semibold text-ok">проверено ботом</span>}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {l.status === "active" && (
                    <button
                      className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-bad"
                      onClick={async () => {
                        const note = await askText("Почему снимаете?", "Нарушение правил площадки.", { text: "Хозяин увидит причину.", ok: "Снять", danger: true });
                        if (note !== null) props.act(() => api.adminHide(l.id, note), "Объявление снято.", load);
                      }}
                    >
                      Снять
                    </button>
                  )}
                  {(l.status === "deleted" || l.status === "blocked") && (
                    <button
                      className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-bad"
                      onClick={async () => (await ask("Стереть насовсем?", { text: "Объявление исчезнет из базы. Вернуть его будет нельзя.", ok: "Стереть", danger: true })) && props.act(() => api.adminPurgeListing(l.id), "Объявление стёрто.", load)}
                    >
                      Стереть насовсем
                    </button>
                  )}
                  {l.status !== "deleted" && l.status !== "blocked" && (
                    <button
                      className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-bad"
                      onClick={async () => {
                        const note = await askText("Удалить объявление?", "Удалено администратором площадки.", { text: "Ждущие запросы отклонятся, подтверждённые брони отменятся. Хозяин получит причину.", ok: "Удалить", danger: true });
                        if (note !== null) props.act(() => api.adminDeleteListing(l.id, note), "Объявление удалено.", load);
                      }}
                    >
                      Удалить
                    </button>
                  )}
                  {(l.status === "blocked" || l.status === "rejected") && (
                    <button className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-accent" onClick={() => props.act(() => api.adminRestore(l.id), "Объявление снова в поиске.", load)}>
                      Вернуть в поиск
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// --- Люди: поиск по номеру или имени, блокировка ----------------------------------------------

function People(props: { act: Act }) {
  const [q, setQ] = useState("");
  const [list, setList] = useCached<AdminUser[]>("people");
  const load = () => api.adminUsers(q).then((r) => setList(r.users), () => setList([]));
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <>
      <SearchField value={q} onChange={setQ} placeholder="Номер телефона или имя" />
      {!list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="mt-3 text-dim">Никого не нашли.</p>
      ) : (
        <ul className="mt-3 card divide-y divide-line">
          {list.map((u) => (
            <li key={u.id} className="px-4 py-4 text-[14px]">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold leading-snug text-ink">{u.name ?? "Без имени"}</span>
                {u.role && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-semibold text-accent">{u.role === "owner" ? "главный" : "модератор"}</span>}
                {u.blocked && <span className="rounded-full bg-bad-soft px-2 py-0.5 text-[12px] font-semibold text-bad">заблокирован</span>}
              </div>
              <div className="mt-1 text-dim">{u.phone ? phoneText(u.phone) : "номер не оставлял"}</div>
              <div className="mt-0.5 text-[13px] text-dim">
                объявлений {u.listings} · броней {u.bookings}
              </div>
              {u.role !== "owner" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {u.blocked ? (
                    <button className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-accent" onClick={() => props.act(() => api.adminBlockUser(u.id, false), "Разблокирован.", load)}>
                        Разблокировать
                      </button>
                  ) : (
                    <button
                        className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-bad"
                        onClick={async () => {
                          const note = await askText("За что блокируете?", "Обман", { text: "Объявления человека снимутся, его брони отменятся.", ok: "Заблокировать", danger: true });
                          if (note !== null) props.act(() => api.adminBlockUser(u.id, true, note), "Заблокирован.", load);
                        }}
                      >
                        Заблокировать
                      </button>
                  )}
                  <button
                      className="flex items-center justify-center gap-1 rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-bad"
                      onClick={async () => {
                        const who = u.name ?? "человека";
                        const sure = await ask(`Удалить ${who}?`, { text: "Его объявления сотрутся насовсем, брони и запросы отменятся. Вернуть будет нельзя.", ok: "Удалить", danger: true });
                        if (!sure) return;
                        // Удаление — одним вопросом. Заблокировать — отдельной кнопкой рядом. Заблокированный остаётся заблокированным
                        props.act(() => api.adminDeleteUser(u.id, !!u.blocked), "Удалён.", load);
                      }}
                    >
                      <Trash2 size={14} aria-hidden /> Удалить
                    </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// --- Обращения в поддержку: ответ уходит человеку в приложение и сообщением от бота ---------------

function Support(props: { act: Act }) {
  const [list, setList] = useCached<SupportTicket[]>("support");
  const load = () => api.adminSupport().then((r) => setList(r.tickets), () => setList((x) => x ?? []));
  useLive(load, 15000);
  if (!list) return <Spinner />;
  if (!list.length) return <p className="text-dim">Обращений нет. Люди пишут из вкладки «Моё», внизу «Написать в поддержку».</p>;
  return (
    <ul className="space-y-3">
      {list.map((t) => {
        const open = !t.reply && !t.closed;
        return (
          <li key={t.id} className="card px-4 py-3.5 text-[14px]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-ink">{t.name ?? "Без имени"}</div>
                <div className="text-[13px] text-dim">
                  {t.phone ? phoneText(t.phone) : "номер не оставлял"} · {when(t.createdAt)}
                </div>
              </div>
              {open && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[12px] font-semibold text-white">новое</span>}
            </div>
            <p className="mt-2 whitespace-pre-line text-ink">{t.text}</p>
            {t.reply && (
              <div className="mt-3 rounded-lg bg-accent-soft px-3 py-2.5">
                <div className="text-[12px] font-semibold text-accent">Ваш ответ</div>
                <p className="mt-0.5 whitespace-pre-line text-ink">{t.reply}</p>
              </div>
            )}
            {open && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-accent"
                  onClick={async () => {
                    const text = await askText("Ответ", "", { text: "Человек увидит ответ в приложении и получит сообщение от бота.", ok: "Отправить", placeholder: "Текст ответа" });
                    if (text) props.act(() => api.adminSupportReply(t.userId, t.id, text), "Ответ отправлен.", load);
                  }}
                >
                  Ответить
                </button>
                <button className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-dim" onClick={() => props.act(() => api.adminSupportReply(t.userId, t.id, "", true), "Обращение закрыто.", load)}>
                  Закрыть без ответа
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// --- Модераторы: главный назначает модераторов по номеру ---------------------------------------

function Team(props: { act: Act; owner: boolean }) {
  const [staff, setStaff] = useCached<StaffRow[]>("team");
  const [stats] = useCached<AdminStats>("stats");
  const [modCode, setModCode] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (props.owner) api.modCode().then((r) => setModCode(r.code), () => {});
  }, [props.owner]);
  const load = () => api.staff().then((r) => setStaff(r.staff), () => setStaff([]));
  useEffect(() => {
    load();
  }, []);
  if (!staff) return <Spinner />;
  return (
    <>
      <ul className="card divide-y divide-line">
        {staff.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-4 px-4 py-3.5 text-[14px]">
            <div>
              <div className="font-semibold text-ink">{m.name ?? `MAX ${m.id}`}</div>
              <div className="text-dim">
                {m.role === "owner" ? "Главный" : "Модератор"}
                {m.phone ? ` · ${phoneText(m.phone)}` : ""}
              </div>
            </div>
            {props.owner && (
              <button
                className="flex shrink-0 items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-bad"
                onClick={async () => (await ask(`Убрать ${m.name ?? "человека"} из модераторов?`, { ok: "Убрать", danger: true })) && props.act(() => api.staffRemove(m.id), "Убран из модераторов.", load)}
                aria-label="Убрать из модераторов"
              >
                <UserMinus size={14} aria-hidden /> Убрать
              </button>
            )}
          </li>
        ))}
      </ul>
      {/* Резервная копия базы: делается сама каждую ночь после 3:00, хранится 30 дней */}
      {props.owner && (
        <p className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-dim">
          {stats?.backup ? `Резервная копия базы: последняя ${stats.backup.day.split("-").reverse().join(".")}, записей ${stats.backup.rows}. Делается сама каждую ночь.` : "Резервная копия базы делается сама каждую ночь после 3:00. Первая появится этой ночью."}
        </p>
      )}
      {props.owner ? (
        <section className="mt-5 card space-y-3 p-4">
          <h2 className="font-bold text-ink">Код модераторов</h2>
          <p className="text-[13px] text-dim">
            Человек отправляет этот код боту и становится модератором: проверка объявлений, заявок и жалоб. Вам придёт сообщение о каждом новом.
            Если код ушёл не тому, смените его, и старый сразу перестанет работать.
          </p>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
            <button className="min-w-0 truncate text-[18px] font-bold tracking-wide text-ink tabular-nums" onClick={() => modCode && navigator.clipboard?.writeText(modCode).then(() => setCopied(true), () => {})}>
              {modCode || "не задан"}
            </button>
            <span className="shrink-0 text-[12px] text-dim">{copied ? "скопировано" : modCode ? "нажмите, чтобы скопировать" : ""}</span>
          </div>
          <button
            className="btn btn-line w-full"
            onClick={async () => {
              if (modCode && !(await ask("Сменить код модераторов?", { text: "Старый перестанет работать. Те, кто уже модератор, останутся.", ok: "Сменить" }))) return;
              props.act(
                async () => {
                  setModCode((await api.modCode(true)).code);
                  setCopied(false);
                },
                "Новый код готов.",
              );
            }}
          >
            {modCode ? "Сменить код" : "Создать код"}
          </button>
        </section>
      ) : (
        <p className="mt-4 text-[14px] text-dim">Назначать модераторов может только главный.</p>
      )}
    </>
  );
}

// --- Брони: все запросы гостей и ближайшие заезды ----------------------------------------------

function Bookings(props: { act: Act }) {
  const [list, setList] = useCached<AdminBookingRow[]>("bookings");
  const load = () => api.adminBookings().then((r) => setList(r.bookings), () => setList((x) => x ?? []));
  useLive(load, 15000);
  if (!list) return <Spinner />;
  if (!list.length) return <p className="text-dim">Активных броней нет.</p>;
  return (
    <ul className="space-y-3">
      {list.map((b) => (
        <li key={b.id} className="card p-4 text-[14px]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-semibold text-ink">{b.title}</div>
              <div className="truncate text-dim">
                {b.locality}
                {b.address ? `, ${b.address}` : ""}
              </div>
            </div>
            <Badge booking={b.status} />
          </div>
          <div className="mt-2 text-ink">
            {rangeText(b.checkIn, b.checkOut)} · {guestsText(b.guests)} · <b className="tabular-nums">{rub(b.total)}</b>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[13px]">
            <div>
              <div className="text-dim">Гость</div>
              <div className="text-ink">{b.guestName ?? "без имени"}</div>
              {b.guestPhone && (
                <a className="font-semibold text-accent" href={`tel:${b.guestPhone}`}>
                  {phoneText(b.guestPhone)}
                </a>
              )}
            </div>
            <div>
              <div className="text-dim">Хозяин</div>
              <div className="text-ink">{b.ownerName ?? "без имени"}</div>
              {b.ownerPhone && (
                <a className="font-semibold text-accent" href={`tel:${b.ownerPhone}`}>
                  {phoneText(b.ownerPhone)}
                </a>
              )}
            </div>
          </div>
          <div className="mt-2 text-[12px] text-dim">
            Запрос {when(b.createdAt)}
            {b.status === "requested" ? ` · хозяин ответит до ${when(b.decideBy)}` : ""}
          </div>
          <button
            className="mt-2 text-[14px] font-semibold text-bad"
            onClick={async () => {
              const note = await askText("Отменить бронь?", "Бронь отменена администратором площадки.", { text: "Гость и хозяин получат это сообщение.", ok: "Отменить бронь", danger: true });
              if (note !== null) props.act(() => api.adminCancelBooking(b.id, note), "Бронь отменена.", load);
            }}
          >
            Отменить бронь
          </button>
        </li>
      ))}
    </ul>
  );
}

// --- История: кто из модераторов что сделал ------------------------------------------------------

function Log() {
  const [entries, setEntries] = useCached<AuditRow[]>("log");
  const remove = async (e: AuditRow) => {
    if (!(await ask("Удалить запись?", { text: "Она пропадёт из истории насовсем.", ok: "Удалить", danger: true }))) return;
    try {
      await api.auditDelete(e.id);
      setEntries((x) => x?.filter((y) => y.id !== e.id) ?? x);
    } catch (err) {
      tell("Не получилось удалить", errorText(err));
    }
  };
  useEffect(() => {
    api.auditLog().then((r) => setEntries(r.entries), () => setEntries([]));
  }, []);
  if (!entries) return <Spinner />;
  if (!entries.length) return <p className="text-dim">Пока пусто.</p>;
  return (
    <ul className="card divide-y divide-line">
      {entries.map((e) => (
        <li key={e.id} className="flex items-start gap-3 px-4 py-3 text-[14px]">
          <div className="min-w-0 flex-1">
            <div className="text-ink">
              <b>{e.byName ?? e.by}</b> {e.action}
            </div>
            <div className="text-dim">{e.target}</div>
            {e.note && <div className="text-dim">«{e.note}»</div>}
            <div className="mt-0.5 text-[12px] text-dim">{when(e.at)}</div>
          </div>
          {e.locked ? (
            <span className="grid size-9 shrink-0 place-items-center text-line" title="Эту запись удалить нельзя">
              <Lock size={16} aria-label="Эту запись удалить нельзя" />
            </span>
          ) : (
            <button className="grid size-9 shrink-0 place-items-center rounded-full text-dim active:bg-surface-2" aria-label="Удалить запись" onClick={() => remove(e)}>
              <Trash2 size={17} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function SearchField(props: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative block">
      <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim" />
      <input className="field pl-10" value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.placeholder} aria-label={props.placeholder} />
    </label>
  );
}
