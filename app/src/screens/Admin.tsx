import { useEffect, useState } from "react";
import { Flag, Search, UserMinus, UserPlus } from "lucide-react";
import { guestsText, nightsFrom, rangeText, rub } from "../../../shared/dates.ts";
import type { Listing } from "../../../shared/types.ts";
import { api, errorText, type AdminBookingRow, type AdminListing, type AdminStats, type AdminUser, type AuditRow, type ComplaintRow, type HostApplicationRow, type StaffRow } from "../lib/api.ts";
import { useLive } from "../lib/live.ts";
import { ask, askText } from "../ui/dialog.tsx";
import { Badge, H1, Spinner, normalizePhone, phoneText } from "../ui/ui.tsx";

// Админка площадки. Модераторы проверяют объявления и жалобы, смотрят людей и журнал.
// Главный (Сергей) ещё и собирает команду: назначает и снимает модераторов.

type Section = "apps" | "bookings" | "complaints" | "review" | "listings" | "people" | "team" | "log";

// Модератор видит только то, что нужно проверять. Главный — всё: брони, объявления, люди, команда, история
const SECTIONS: { id: Section; title: string; owner?: boolean }[] = [
  { id: "review", title: "Проверка" },
  { id: "apps", title: "Заявки" },
  { id: "complaints", title: "Жалобы" },
  { id: "bookings", title: "Брони", owner: true },
  { id: "listings", title: "Объявления", owner: true },
  { id: "people", title: "Люди", owner: true },
  { id: "team", title: "Команда", owner: true },
  { id: "log", title: "История", owner: true },
];

const when = (ms: number) => new Date(ms).toLocaleString("ru-RU", { timeZone: "Europe/Samara", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function AdminScreen(props: { owner: boolean }) {
  const [section, setSection] = useState<Section>("review");
  const sections = SECTIONS.filter((x) => !x.owner || props.owner);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useLive(() => api.stats().then(setStats), 30000, [section]);

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
      {stats && (
        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          {[
            ["В поиске", stats.listings.active ?? 0],
            ["Броней за неделю", stats.bookingsWeek],
            ["Людей", stats.users],
          ].map(([t, v]) => (
            <div key={t} className="card px-2 py-2.5">
              <div className="text-[20px] font-bold text-ink tabular-nums">{v}</div>
              <div className="text-[12px] leading-tight text-dim">{t}</div>
            </div>
          ))}
        </div>
      )}
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" role="tablist">
        {sections.map((s) => (
          <button key={s.id} role="tab" aria-selected={section === s.id} className="chip shrink-0" aria-pressed={section === s.id} onClick={() => { setSection(s.id); setMsg(null); }}>
            {s.title}
            {s.id === "complaints" && stats?.openComplaints ? <span className="ml-1.5 rounded-full bg-bad px-1.5 text-[11px] font-bold text-white">{stats.openComplaints}</span> : null}
            {s.id === "apps" && stats?.pendingHosts ? <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">{stats.pendingHosts}</span> : null}
          </button>
        ))}
      </div>
      {msg && <p className="mb-3 rounded-lg bg-accent-soft p-3 text-[14px] text-ink">{msg}</p>}

      {section === "apps" && <Applications act={act} />}
      {section === "bookings" && props.owner && <Bookings act={act} />}
      {section === "complaints" && <Complaints act={act} owner={props.owner} />}
      {section === "review" && <Review act={act} />}
      {section === "listings" && <AllListings act={act} />}
      {section === "people" && <People act={act} />}
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
  const [list, setList] = useState<HostApplicationRow[] | null>(null);
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
          <div className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${a.hints.flags.length ? "bg-[#f6ecd9] text-warn" : "bg-[#e2efe3] text-ok"}`}>
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

function Complaints(props: { act: Act; owner: boolean }) {
  const [complaints, setComplaints] = useState<ComplaintRow[] | null>(null);
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
              <li key={c.id} className="card p-4 text-[14px]">
                <div className="font-semibold text-ink">{c.title}</div>
                <div className="text-bad">{c.reasonTitle}</div>
                {c.text && <p className="mt-1">«{c.text}»</p>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="btn btn-line min-h-11" onClick={() => props.act(() => api.resolveComplaint(c.id, "hide"), "Объявление скрыто.", load)}>
                    Скрыть объявление
                  </button>
                  <button className="btn btn-line min-h-11" onClick={() => props.act(() => api.resolveComplaint(c.id, "ok"), "Жалоба закрыта.", load)}>
                    Всё в порядке
                  </button>
                </div>
                {props.owner && <button
                  className="mt-2 w-full text-[14px] font-semibold text-bad"
                  onClick={async () => (await ask("Заблокировать хозяина?", { text: "Все его объявления снимутся, гостям придёт отмена.", ok: "Заблокировать", danger: true })) && props.act(() => api.resolveComplaint(c.id, "ban"), "Хозяин заблокирован.", load)}
                >
                  Заблокировать хозяина
                </button>}
                <button className="mt-2 w-full text-[14px] font-semibold text-dim" onClick={() => props.act(() => api.resolveComplaint(c.id, "dismiss"), "Жалоба удалена.", load)}>
                  Удалить жалобу (пустая или ложная)
                </button>
              </li>
            ))}
      </ul>
    </section>
  );
}

// --- Проверка: новые и изменённые объявления ---------------------------------------------

function Review(props: { act: Act }) {
  const [list, setList] = useState<(Listing & { title: string; held: string[] })[] | null>(null);
  const load = () => api.pending().then((r) => setList(r.listings), () => setList((x) => x ?? []));
  // Новое приходит само, без перезагрузки
  useLive(load, 15000);
  if (!list) return <Spinner />;
  return (
    <>
      {list.length === 0 && <p className="text-dim">Все объявления проверены.</p>}
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
];

function AllListings(props: { act: Act }) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<AdminListing[] | null>(null);
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
              <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-surface-2">{l.photo && <img src={l.photo} alt="" className="size-full object-cover" />}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-ink">{l.title}</div>
                <div className="truncate text-dim">
                  {l.locality}, {l.address}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <Badge listing={l.status} />
                  {l.status === "active" && l.botChecked && <span className="text-[12px] font-semibold text-ok">проверено ботом</span>}
                  {l.status === "active" && (
                    <button
                      className="font-semibold text-bad"
                      onClick={async () => {
                        const note = await askText("Почему снимаете?", "Нарушение правил площадки.", { text: "Хозяин увидит причину.", ok: "Снять", danger: true });
                        if (note !== null) props.act(() => api.adminHide(l.id, note), "Объявление снято.", load);
                      }}
                    >
                      Снять
                    </button>
                  )}
                  {l.status !== "deleted" && (
                    <button
                      className="font-semibold text-bad"
                      onClick={async () => {
                        const note = await askText("Удалить объявление?", "Удалено администратором площадки.", { text: "Ждущие запросы отклонятся, подтверждённые брони отменятся. Хозяин получит причину.", ok: "Удалить", danger: true });
                        if (note !== null) props.act(() => api.adminDeleteListing(l.id, note), "Объявление удалено.", load);
                      }}
                    >
                      Удалить
                    </button>
                  )}
                  {(l.status === "blocked" || l.status === "rejected") && (
                    <button className="font-semibold text-accent" onClick={() => props.act(() => api.adminRestore(l.id), "Объявление снова в поиске.", load)}>
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
  const [list, setList] = useState<AdminUser[] | null>(null);
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
            <li key={u.id} className="p-3 text-[14px]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-ink">
                    {u.name ?? "Без имени"}
                    {u.role && <span className="ml-2 rounded bg-accent-soft px-1.5 text-[12px] font-semibold text-accent">{u.role === "owner" ? "главный" : "модератор"}</span>}
                    {u.blocked && <span className="ml-2 rounded bg-[#f5e1dd] px-1.5 text-[12px] font-semibold text-bad">заблокирован</span>}
                  </div>
                  <div className="text-dim">
                    {u.phone ? phoneText(u.phone) : "номер не оставлял"} · объявлений {u.listings} · броней {u.bookings}
                  </div>
                </div>
                {u.role !== "owner" &&
                  (u.blocked ? (
                    <button className="shrink-0 font-semibold text-accent" onClick={() => props.act(() => api.adminBlockUser(u.id, false), "Разблокирован.", load)}>
                      Разблокировать
                    </button>
                  ) : (
                    <button
                      className="shrink-0 font-semibold text-bad"
                      onClick={async () => {
                        const note = await askText("За что блокируете?", "Обман", { text: "Объявления человека снимутся, его брони отменятся.", ok: "Заблокировать", danger: true });
                        if (note !== null) props.act(() => api.adminBlockUser(u.id, true, note), "Заблокирован.", load);
                      }}
                    >
                      Заблокировать
                    </button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// --- Модераторы: главный назначает модераторов по номеру ---------------------------------------

function Team(props: { act: Act; owner: boolean }) {
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
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
          <li key={m.id} className="flex items-center justify-between gap-2 p-3 text-[14px]">
            <div>
              <div className="font-semibold text-ink">{m.name ?? `MAX ${m.id}`}</div>
              <div className="text-dim">
                {m.role === "owner" ? "Главный" : "Модератор"}
                {m.phone ? ` · ${phoneText(m.phone)}` : ""}
              </div>
            </div>
            {props.owner && (
              <button
                className="flex shrink-0 items-center gap-1 font-semibold text-bad"
                onClick={async () => (await ask(`Убрать ${m.name ?? "человека"} из модераторов?`, { ok: "Убрать", danger: true })) && props.act(() => api.staffRemove(m.id), "Убран из модераторов.", load)}
                aria-label="Убрать из модераторов"
              >
                <UserMinus size={16} /> Убрать
              </button>
            )}
          </li>
        ))}
      </ul>
      {props.owner ? (
        <section className="mt-5 card space-y-3 p-4">
          <h2 className="font-bold text-ink">Код модераторов</h2>
          <p className="text-[13px] text-dim">
            Человек отправляет этот код боту и становится модератором: проверка объявлений, заявок и жалоб. Вам придёт сообщение о каждом новом.
            Если код ушёл не тому — смените, старый сразу перестанет работать.
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
  const [list, setList] = useState<AdminBookingRow[] | null>(null);
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
  const [entries, setEntries] = useState<AuditRow[] | null>(null);
  useEffect(() => {
    api.auditLog().then((r) => setEntries(r.entries), () => setEntries([]));
  }, []);
  if (!entries) return <Spinner />;
  if (!entries.length) return <p className="text-dim">Пока пусто.</p>;
  return (
    <ul className="card divide-y divide-line">
      {entries.map((e, i) => (
        <li key={i} className="p-3 text-[14px]">
          <div className="text-ink">
            <b>{e.byName ?? e.by}</b> {e.action}
          </div>
          <div className="text-dim">{e.target}</div>
          {e.note && <div className="text-dim">«{e.note}»</div>}
          <div className="mt-0.5 text-[12px] text-dim">{when(e.at)}</div>
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
