import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Camera, Home, Plus, Trash2 } from "lucide-react";
import { MAX_PHOTOS } from "../../../shared/catalog.ts";
import { addDays, guestsText, nightsText, rangeText, rub, todaySamara } from "../../../shared/dates.ts";
import { hasContacts } from "../../../shared/trust.ts";
import { CANCEL_OPTIONS, PLACE_TYPES, type Listing } from "../../../shared/types.ts";
import { api, errorText, type BookingView, type HostListingRow, type Me } from "../lib/api.ts";
import { haptic } from "../lib/max.ts";
import { Badge, H1, PhoneGate, Spinner, Stepper, Sticky, phoneText } from "../ui/ui.tsx";

// --- Главная хозяина: запросы на бронь сверху, ниже объявления ----------------------------

export function HostHome(props: { me: Me; onPhone: (p: string) => void; onEdit: (id: string | null) => void; onCalendar: (id: string) => void }) {
  const [rows, setRows] = useState<HostListingRow[] | null>(null);
  const [bookings, setBookings] = useState<BookingView[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const load = () => {
    api.hostListings().then((r) => setRows(r.listings), () => setRows([]));
    api.hostBookings().then((r) => setBookings(r.bookings), () => {});
  };
  useEffect(load, []);

  if (!props.me.user.phone || !props.me.user.consent) {
    return (
      <>
        <H1 sub="Размещение бесплатное. Гости присылают запросы, вы подтверждаете.">Сдать жильё посуточно</H1>
        <PhoneGate why="По нему с вами свяжутся гости после подтверждения брони. До этого номер никто не видит." onDone={props.onPhone} />
      </>
    );
  }
  // Сдавать может только тот, чью заявку одобрил модератор. Обычный человек — только бронирует
  if (props.me.host !== "approved") return <HostApply me={props.me} />;
  if (!rows) return <Spinner />;

  const noshow = async (b: BookingView) => {
    if (!confirm("Отметить, что гость не приехал? Бронь закроется, гость получит предупреждение.")) return;
    try {
      await api.noshow(b.id);
      setNote("Отмечено. После двух таких случаев гость больше не сможет бронировать.");
      load();
    } catch (e) {
      setNote(errorText(e));
    }
  };

  const decide = async (b: BookingView, accept: boolean) => {
    try {
      const r = await api.decide(b.id, accept);
      haptic("success");
      setNote(r.message);
      load();
    } catch (e) {
      setNote(errorText(e));
    }
  };
  const today = todaySamara();
  const requests = bookings.filter((b) => b.status === "requested");
  const upcoming = bookings.filter((b) => b.status === "confirmed" && b.checkOut >= today);

  return (
    <>
      <H1>Сдать жильё</H1>
      {note && <p className="mb-3 rounded-lg bg-accent-soft p-3 text-[14px] text-ink">{note}</p>}

      {requests.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-[17px] font-bold text-ink">Запросы на бронь</h2>
          <ul className="space-y-3">
            {requests.map((b) => (
              <li key={b.id} className="card p-4">
                <div className="font-semibold text-ink">{b.title}</div>
                <div className="text-[14px] text-dim">
                  {rangeText(b.checkIn, b.checkOut)}, {nightsText(b.nights)}, {guestsText(b.guests)}, {rub(b.total)}
                </div>
                <div className="mt-1 text-[14px]">Гость: {b.guestName ?? "без имени"}</div>
                {b.comment && <div className="text-[14px] text-dim">«{b.comment}»</div>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="btn btn-main" onClick={() => decide(b, true)}>
                    Принять
                  </button>
                  <button className="btn btn-line" onClick={() => decide(b, false)}>
                    Отклонить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-[17px] font-bold text-ink">Ближайшие заезды</h2>
          <ul className="space-y-2">
            {upcoming.map((b) => (
              <li key={b.id} className="card p-3 text-[14px]">
                <div className="font-semibold text-ink">
                  {rangeText(b.checkIn, b.checkOut)} · {b.title}
                </div>
                {b.checkIn <= today && (
                  <button className="float-right text-[13px] font-semibold text-bad" onClick={() => noshow(b)}>
                    Гость не приехал
                  </button>
                )}
                <div className="text-dim">
                  {guestsText(b.guests)}, {rub(b.total)}
                  {b.phone && (
                    <>
                      {" · "}
                      <a className="font-semibold text-accent" href={`tel:${b.phone}`}>
                        {phoneText(b.phone)}
                      </a>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="mb-2 text-[17px] font-bold text-ink">Мои объявления</h2>
      {rows.length === 0 && <p className="mb-3 text-[15px] text-dim">Пока нет объявлений. Добавьте первое, это займёт минут десять.</p>}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="card flex gap-3 p-3">
            <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-surface-2">{r.photo ? <img src={r.photo} alt="" className="size-full object-cover" /> : <Home className="m-auto mt-5 text-dim" />}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-ink">{r.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <Badge listing={r.status} />
                {r.requests > 0 && <span className="text-[13px] font-semibold text-accent">запросов: {r.requests}</span>}
              </div>
              {r.moderatorNote && r.status === "rejected" && <p className="mt-1 text-[13px] text-bad">{r.moderatorNote}</p>}
              <div className="mt-2 flex gap-4 text-[14px] font-semibold text-accent">
                <button onClick={() => props.onEdit(r.id)}>Изменить</button>
                <button onClick={() => props.onCalendar(r.id)}>Календарь</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Sticky>
        <button className="btn btn-main w-full" onClick={() => props.onEdit(null)}>
          <Plus size={19} /> Добавить объявление
        </button>
      </Sticky>
    </>
  );
}

// --- Заявка «хочу сдавать» ---------------------------------------------------------------

/** Без одобрения модератора объявления не размещаются: так площадку не заполнят мошенники */
function HostApply(props: { me: Me }) {
  const [status, setStatus] = useState(props.me.host);
  const [name, setName] = useState(props.me.user.name ?? "");
  const [city, setCity] = useState(props.me.localities[0] ?? "Самара");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "pending") {
    return (
      <>
        <H1 sub="Модератор посмотрит её и ответит в чате с ботом. Обычно это занимает до суток.">Заявка отправлена</H1>
        <p className="text-[14px] text-dim">Пока ждёте, можно бронировать жильё как гость.</p>
      </>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.hostApply({ name: name.trim(), city, about: about.trim() });
      haptic("success");
      setStatus("pending");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <H1 sub="Размещение бесплатное. Чтобы на площадке не было обмана, каждого хозяина сначала проверяет модератор.">Сдавать жильё</H1>
      {status === "rejected" && props.me.hostNote && <p className="mb-4 rounded-lg bg-[#f5e1dd] p-3 text-[14px] text-bad">Прошлая заявка не одобрена: {props.me.hostNote}</p>}
      <section className="card space-y-4 p-4">
        <div>
          <label className="label" htmlFor="ha-name">
            Как к вам обращаться
          </label>
          <input id="ha-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя и фамилия" maxLength={80} />
        </div>
        <div>
          <label className="label" htmlFor="ha-city">
            Где жильё
          </label>
          <select id="ha-city" className="field" value={city} onChange={(e) => setCity(e.target.value)}>
            {props.me.localities.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ha-about">
            Пара слов о жилье <span className="font-normal text-dim">(необязательно)</span>
          </label>
          <textarea id="ha-about" className="field resize-none" rows={3} maxLength={500} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Например, однушка у набережной, сдаю два года" />
        </div>
        <p className="text-[13px] text-dim">Модератор увидит ваш номер {props.me.user.phone ? phoneText(props.me.user.phone) : ""} и может позвонить, чтобы познакомиться.</p>
      </section>
      {error && <p className="mt-3 text-[14px] text-bad">{error}</p>}
      <Sticky>
        <button className="btn btn-main w-full" disabled={busy || name.trim().length < 2} onClick={submit}>
          Отправить заявку
        </button>
      </Sticky>
    </>
  );
}

// --- Анкета объявления -------------------------------------------------------------------

type Form = Partial<Listing>;

/**
 * Фото с телефона → JPEG до 1600 px по длинной стороне, качество 0,82.
 * Перерисовка через canvas убирает метаданные, в том числе геометку: по фото не вычислить адрес
 */
async function toJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error("bad image"));
      i.src = url;
    });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function HostForm(props: { me: Me; id: string | null; onSaved: (id: string) => void; onDone: () => void }) {
  const [id, setId] = useState(props.id);
  const [l, setL] = useState<Listing | null>(null);
  const [form, setForm] = useState<Form>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  // Первое заполнение формы (загрузка с сервера) — не правка человека, черновик из-за него не сохраняем
  const touched = useRef(false);

  useEffect(() => {
    if (!props.id) {
      setForm({ type: "flat", locality: "Самара", rooms: 1, guests: 2, beds: 1, minNights: 1, cancelDays: 0, checkIn: "14:00", checkOut: "12:00", rules: { pets: false, smoking: false, kids: true, parties: false }, amenities: [] });
      return;
    }
    api.hostListing(props.id).then((r) => {
      setL(r.listing);
      setForm(r.listing);
      setMissing(r.missing);
    });
  }, [props.id]);

  const set = (patch: Form) => {
    touched.current = true;
    setForm((f) => ({ ...f, ...patch }));
  };

  // Черновик сохраняется сам через 2 секунды после последней правки: остановился на полпути — ничего не пропадёт.
  // Только для черновиков и возвращённых: опубликованное правится кнопкой «Сохранить» (правки уходят на проверку)
  const autosave = !l || l.status === "draft" || l.status === "rejected";
  useEffect(() => {
    if (!touched.current || !autosave) return;
    const t = setTimeout(async () => {
      try {
        const r = await api.hostSave(id, form);
        setL(r.listing);
        setMissing(r.missing);
        if (!id) {
          setId(r.listing.id);
          props.onSaved(r.listing.id);
        }
        setDraftNote(`Черновик сохранён в ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`);
      } catch {
        // Не получилось (например, телефон в описании) — молча; при «Опубликовать» человек увидит причину
      }
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.hostSave(id, form);
      setL(r.listing);
      setMissing(r.missing);
      if (!id) {
        setId(r.listing.id);
        props.onSaved(r.listing.id);
      }
      setMsg(r.listing.status === "pending" && l?.status === "active" ? "Сохранено. Изменения проверит модератор." : "Сохранено.");
      return r.listing.id;
    } catch (e) {
      setMsg(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** Фото прямо из приложения: выбрал в галерее — сжали, загрузили по одному, показали */
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const lid = id ?? (await save());
    if (!lid) return;
    const list = [...files].slice(0, MAX_PHOTOS - (l?.photos.length ?? 0));
    setMsg(null);
    for (const [i, f] of list.entries()) {
      setUploading(`Загружаем ${i + 1} из ${list.length}…`);
      try {
        const r = await api.photoUpload(lid, await toJpeg(f));
        setL(r.listing);
        setMissing(r.missing);
      } catch (e) {
        setMsg(errorText(e));
        break;
      }
    }
    setUploading(null);
  };

  const reorder = async (order: number[]) => {
    if (!id) return;
    const r = await api.photosOrder(id, order);
    setL(r.listing);
    setMissing(r.missing);
  };

  const submit = async () => {
    const lid = await save();
    if (!lid) return;
    try {
      await api.submit(lid);
      haptic("success");
      props.onDone();
    } catch (e) {
      setMsg(errorText(e));
    }
  };

  if (props.id && !l) return <Spinner />;
  const districts = props.me.districts[form.locality ?? ""] ?? [];
  const photos = l?.photos ?? [];
  const canSubmit = l && ["draft", "rejected", "paused"].includes(l.status);
  const toggleAmenity = (a: string) => set({ amenities: form.amenities?.includes(a) ? form.amenities.filter((x) => x !== a) : [...(form.amenities ?? []), a] });

  return (
    <>
      <H1 sub={l ? <Badge listing={l.status} /> : "Заполните, добавьте фото и опубликуйте. Объявление сразу появится в поиске."}>{props.id ? "Объявление" : "Новое объявление"}</H1>
      {l?.status === "rejected" && l.moderatorNote && <p className="mb-3 rounded-lg bg-[#f5e1dd] p-3 text-[14px] text-bad">Модератор: {l.moderatorNote}</p>}

      <div className="space-y-5">
        <section>
          <span className="label">Что сдаёте</span>
          <div className="flex flex-wrap gap-2">
            {PLACE_TYPES.map((t) => (
              <button key={t.id} type="button" className="chip" aria-pressed={form.type === t.id} onClick={() => set({ type: t.id })}>
                {t.title}
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-3">
          <div>
            <label className="label" htmlFor="f-loc">
              Город или посёлок
            </label>
            <select id="f-loc" className="field" value={form.locality} onChange={(e) => set({ locality: e.target.value, district: "" })}>
              {props.me.localities.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-dis">
              Район
            </label>
            {districts.length ? (
              <select id="f-dis" className="field" value={form.district ?? ""} onChange={(e) => set({ district: e.target.value })}>
                <option value="">Не указан</option>
                {districts.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            ) : (
              <input id="f-dis" className="field" value={form.district ?? ""} onChange={(e) => set({ district: e.target.value })} placeholder="Например, центр" />
            )}
          </div>
          <div>
            <label className="label" htmlFor="f-adr">
              Адрес
            </label>
            <input id="f-adr" className="field" value={form.address ?? ""} onChange={(e) => set({ address: e.target.value })} placeholder="Улица, дом, квартира" />
            <p className="mt-1 text-[13px] text-dim">Гость увидит адрес только после того, как вы подтвердите бронь.</p>
          </div>
        </section>

        <section className="card divide-y divide-line">
          {(
            [
              ["rooms", "Комнат", 1, 10],
              ["guests", "Гостей максимум", 1, 20],
              ["beds", "Спальных мест", 1, 20],
              ["minNights", "Ночей минимум", 1, 30],
            ] as const
          ).map(([k, title, min, max]) => (
            <div key={k} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[15px] text-ink">{title}</span>
              <Stepper label={title} value={(form[k] as number) ?? min} min={min} max={max} onChange={(v) => set({ [k]: v } as Form)} />
            </div>
          ))}
        </section>

        <section className="grid grid-cols-2 gap-3">
          {(
            [
              ["area", "Площадь, м²"],
              ["floor", "Этаж"],
              ["priceWeekday", "Ночь в будни, ₽"],
              ["priceWeekend", "Ночь в пт и сб, ₽"],
              ["deposit", "Залог, ₽"],
            ] as const
          ).map(([k, title]) => (
            <div key={k}>
              <label className="label" htmlFor={`f-${k}`}>
                {title}
              </label>
              <input
                id={`f-${k}`}
                className="field tabular-nums"
                inputMode="numeric"
                value={form[k] == null || form[k] === 0 ? "" : String(form[k])}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  set({ [k]: v === "" ? (k === "area" || k === "floor" ? null : 0) : Number(v) } as Form);
                }}
                placeholder={k === "deposit" ? "0" : ""}
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="f-in">
                Заезд
              </label>
              <input id="f-in" className="field" type="time" value={form.checkIn ?? "14:00"} onChange={(e) => set({ checkIn: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="f-out">
                Выезд
              </label>
              <input id="f-out" className="field" type="time" value={form.checkOut ?? "12:00"} onChange={(e) => set({ checkOut: e.target.value })} />
            </div>
          </div>
        </section>

        <section>
          <span className="label">Правила</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["kids", "Можно с детьми"],
                ["pets", "Можно с животными"],
                ["smoking", "Можно курить"],
                ["parties", "Можно вечеринки"],
              ] as const
            ).map(([k, title]) => (
              <button key={k} type="button" className="chip" aria-pressed={!!form.rules?.[k]} onClick={() => set({ rules: { ...form.rules!, [k]: !form.rules?.[k] } })}>
                {title}
              </button>
            ))}
          </div>
        </section>

        <section>
          <span className="label">Бесплатная отмена для гостя</span>
          <div className="flex flex-wrap gap-2">
            {CANCEL_OPTIONS.map((o) => (
              <button key={o.days} type="button" className="chip" aria-pressed={(form.cancelDays ?? 0) === o.days} onClick={() => set({ cancelDays: o.days })}>
                {o.title}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[13px] text-dim">Если гость отменит позже, вы увидите это в сообщении об отмене.</p>
        </section>

        <section>
          <span className="label">Удобства</span>
          <div className="flex flex-wrap gap-2">
            {props.me.amenities.map((a) => (
              <button key={a} type="button" className="chip" aria-pressed={!!form.amenities?.includes(a)} onClick={() => toggleAmenity(a)}>
                {a}
              </button>
            ))}
          </div>
        </section>

        <section>
          <label className="label" htmlFor="f-desc">
            Описание
          </label>
          <textarea
            id="f-desc"
            className="field resize-none"
            rows={5}
            maxLength={3000}
            value={form.description ?? ""}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Что рядом, какой ремонт, есть ли парковка, как заселяетесь"
          />
          {hasContacts(form.description ?? "") ? (
            <p className="mt-1 text-[13px] text-bad">Уберите телефоны, ссылки и мессенджеры: так не сохранится. Номер гость получит после подтверждения брони.</p>
          ) : (
            <p className="mt-1 text-[13px] text-dim">Без телефонов и ссылок: гость получит ваш номер, когда вы подтвердите бронь.</p>
          )}
        </section>

        <section>
          <span className="label">
            Фото <span className="font-normal text-dim">({photos.length} из {MAX_PHOTOS}, минимум 3)</span>
          </span>
          {photos.length > 0 && (
            <ul className="mb-3 grid grid-cols-3 gap-2">
              {photos.map((p, i) => (
                <li key={p.url} className="relative overflow-hidden rounded-lg">
                  <img src={p.url} alt="" className="aspect-square w-full object-cover" />
                  {i === 0 && <span className="absolute top-1 left-1 rounded bg-ink/80 px-1.5 text-[11px] font-semibold text-white">обложка</span>}
                  <div className="absolute inset-x-0 bottom-0 flex justify-between bg-ink/60 p-1 text-white">
                    <button aria-label="Раньше" disabled={i === 0} onClick={() => reorder(photos.map((_, j) => j).map((j) => (j === i ? i - 1 : j === i - 1 ? i : j)))}>
                      <ArrowLeft size={16} />
                    </button>
                    <button aria-label="Удалить фото" onClick={() => reorder(photos.map((_, j) => j).filter((j) => j !== i))}>
                      <Trash2 size={16} />
                    </button>
                    <button aria-label="Позже" disabled={i === photos.length - 1} onClick={() => reorder(photos.map((_, j) => j).map((j) => (j === i ? i + 1 : j === i + 1 ? i : j)))}>
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <label className={`btn btn-soft w-full ${uploading || photos.length >= MAX_PHOTOS ? "pointer-events-none opacity-50" : ""}`}>
            <Camera size={18} /> {uploading ?? (photos.length ? "Добавить ещё фото" : "Добавить фото")}
            <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} disabled={!!uploading} />
          </label>
          <p className="mt-1 text-[13px] text-dim">Светлые фото самой квартиры: комнаты, кухня, ванная. Первое станет обложкой.</p>
        </section>
      </div>

      {msg && <p className="mt-4 rounded-lg bg-accent-soft p-3 text-[14px] text-ink">{msg}</p>}
      {draftNote && !msg && <p className="mt-3 text-[13px] text-dim">{draftNote}</p>}
      {canSubmit && missing.length > 0 && <p className="mt-3 text-[14px] text-dim">Чтобы опубликовать, не хватает: {missing.join(", ")}.</p>}
      {l?.status === "active" && (
        <button className="mt-4 text-[14px] font-semibold text-dim" onClick={async () => setL((await api.pause(l.id, true)).listing)}>
          Снять с показа на время
        </button>
      )}
      {l?.status === "paused" && (
        <button className="mt-4 text-[14px] font-semibold text-accent" onClick={async () => setL((await api.pause(l.id, false)).listing)}>
          Вернуть в поиск
        </button>
      )}

      <Sticky>
        {canSubmit ? (
          <button className="btn btn-main w-full" onClick={submit} disabled={busy}>
            Опубликовать
          </button>
        ) : (
          <button className="btn btn-main w-full" onClick={save} disabled={busy}>
            Сохранить
          </button>
        )}
      </Sticky>
    </>
  );
}

// --- Календарь: хозяин закрывает даты, занятые бронями видны сразу -------------------------

const WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export function HostCalendar(props: { id: string }) {
  const [closed, setClosed] = useState<Set<string> | null>(null);
  const [booked, setBooked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [month, setMonth] = useState(todaySamara().slice(0, 7));
  const today = todaySamara();

  useEffect(() => {
    api.hostListing(props.id).then((r) => setTitle(`${r.listing.locality}, ${r.listing.address}`));
    api.calendar(props.id, [], []).then((r) => {
      setClosed(new Set(r.closed));
      setBooked(new Set(r.booked));
    });
  }, [props.id]);

  const days = useMemo(() => {
    const first = `${month}-01`;
    const shift = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
    const out: (string | null)[] = Array(shift).fill(null);
    for (let d = first; d.startsWith(month); d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);

  if (!closed) return <Spinner />;
  const toggle = async (d: string) => {
    if (d < today || booked.has(d)) return;
    const isClosed = closed.has(d);
    const r = await api.calendar(props.id, isClosed ? [] : [d], isClosed ? [d] : []);
    setClosed(new Set(r.closed));
    setBooked(new Set(r.booked));
  };
  const [y, m] = month.split("-").map(Number);
  const shiftMonth = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));

  return (
    <>
      <H1 sub={title}>Календарь</H1>
      <div className="mb-3 flex items-center justify-between">
        <button className="btn btn-line size-10 min-h-0 p-0" onClick={() => shiftMonth(-1)} disabled={month <= today.slice(0, 7)} aria-label="Прошлый месяц">
          <ArrowLeft size={18} />
        </button>
        <b className="text-ink">
          {MONTHS[m - 1]} {y}
        </b>
        <button className="btn btn-line size-10 min-h-0 p-0" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
          <ArrowRight size={18} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[13px]">
        {WEEK.map((w) => (
          <div key={w} className="py-1 text-dim">
            {w}
          </div>
        ))}
        {days.map((d, i) =>
          d ? (
            <button
              key={d}
              onClick={() => toggle(d)}
              disabled={d < today}
              className={`aspect-square rounded-lg text-[15px] tabular-nums ${
                booked.has(d) ? "bg-accent font-semibold text-white" : closed.has(d) ? "bg-surface-2 text-dim line-through" : d < today ? "text-line" : "bg-surface text-ink"
              }`}
              aria-label={`${Number(d.slice(8))}: ${booked.has(d) ? "забронировано" : closed.has(d) ? "закрыто" : "свободно"}`}
            >
              {Number(d.slice(8))}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
      <ul className="mt-4 space-y-1 text-[14px] text-dim">
        <li className="flex items-center gap-2">
          <span className="size-4 rounded bg-accent" /> забронировано
        </li>
        <li className="flex items-center gap-2">
          <span className="size-4 rounded bg-surface-2" /> закрыто вами, гости не смогут выбрать
        </li>
        <li className="flex items-center gap-2">
          <CalendarDays size={16} /> нажмите на день, чтобы закрыть или открыть
        </li>
      </ul>
    </>
  );
}
