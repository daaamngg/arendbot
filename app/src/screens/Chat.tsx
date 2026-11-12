import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Clock3, Home, MessageCircle, RotateCw, SendHorizontal, Trash2 } from "lucide-react";
import { api, errorText, type ChatMsg, type ThreadView } from "../lib/api.ts";
import { useLive } from "../lib/live.ts";
import { ask, tell } from "../ui/dialog.tsx";

// Переписка гостя с хозяином до брони. Сообщения дублируются в чат MAX, ответить можно и там.
// Контакты сервер прячет: сделка остаётся на площадке, гость защищён от «переведите на карту»

/** Своё сообщение, которое ещё летит на сервер или не дошло: показываем сразу, с пометкой */
interface Outgoing {
  key: string;
  text: string;
  createdAt: number;
  state: "sending" | "failed";
}
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 40);

const timeText = (ms: number) => new Date(ms).toLocaleString("ru-RU", { timeZone: "Europe/Samara", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });

/** listingId — гость открывает переписку из объявления; id — открыть существующую */
export function ChatScreen(props: { id?: string; listingId?: string; onListing: (id: string) => void }) {
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const vp = useVisualViewport();

  useEffect(() => {
    const load = props.id ? api.chatThread(props.id) : api.chatOpen(props.listingId!);
    load.then(
      (r) => {
        setThread(r.thread);
        setMessages(r.messages);
      },
      () => setFailed(true),
    );
  }, [props.id, props.listingId]);

  // Новые сообщения подтягиваем раз в 4 секунды, пока экран открыт, и сразу при возврате в приложение
  useLive(
    () => {
      if (thread) return api.chatThread(thread.id).then((r) => setMessages(r.messages));
    },
    4000,
    [thread?.id],
  );

  // Новое сообщение или открылась клавиатура — лента прокручивается к последнему
  useEffect(() => {
    scroller.current?.scrollTo({ top: 1e9 });
  }, [messages.length, outbox.length, vp.height]);

  if (failed) return <p className="text-bad">Переписка недоступна: объявление снято или ссылка устарела.</p>;
  if (!thread) return null;

  // Сообщение появляется в ленте сразу, поле очищается. Не дошло — остаётся в ленте с кнопкой «Повторить»,
  // текст не теряется. Повтор идёт с той же меткой, поэтому дубля на сервере не будет
  const deliver = async (o: Outgoing) => {
    setOutbox((list) => list.map((x) => (x.key === o.key ? { ...x, state: "sending" } : x)));
    try {
      const r = await api.chatSend(thread.id, o.text, o.key);
      if (r.masked) setNote("Телефоны и ссылки в сообщениях скрываются. Номер появится, когда бронь подтвердят.");
      const fresh = await api.chatThread(thread.id);
      setMessages(fresh.messages);
      setOutbox((list) => list.filter((x) => x.key !== o.key));
    } catch (e) {
      setOutbox((list) => list.map((x) => (x.key === o.key ? { ...x, state: "failed" } : x)));
      setNote(errorText(e));
    }
  };
  const removeMsg = async (m: ChatMsg) => {
    if (!(await ask("Удалить сообщение?", { text: "Оно пропадёт и у собеседника.", ok: "Удалить", danger: true }))) return;
    try {
      await api.chatDelete(thread.id, m.id);
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, deleted: true, text: "" } : x)));
    } catch (e) {
      tell("Не получилось удалить", errorText(e));
    }
  };
  const sendMsg = () => {
    const v = text.trim();
    if (!v) return;
    setNote(null);
    setText("");
    if (input.current) input.current.style.height = "auto";
    const o: Outgoing = { key: newKey(), text: v, createdAt: Date.now(), state: "sending" };
    setOutbox((list) => [...list, o]);
    deliver(o);
  };

  const mine = (m: ChatMsg) => m.from === thread.role;
  // Одна лента: присланные + свои, которые ещё летят. Подряд идущие от одного человека — группой, «хвостик» у последнего
  type Row = { key: string; own: boolean; text: string; at: number; deleted?: boolean; state?: Outgoing["state"]; msg?: ChatMsg; out?: Outgoing };
  const rows: Row[] = [
    ...messages.map((m) => ({ key: m.id, own: mine(m), text: m.text, at: m.createdAt, deleted: m.deleted, msg: m })),
    ...outbox.map((o) => ({ key: o.key, own: true, text: o.text, at: o.createdAt, state: o.state, out: o })),
  ];
  return (
    // Экран переписки как в Telegram: закреплён между шапкой и низом видимой области — когда открывается клавиатура,
    // поле ввода поднимается над ней, а не прячется под неё
    <div className="fixed inset-x-0 z-10 mx-auto flex max-w-[560px] flex-col bg-[#e7ebe6]" style={{ top: vp.top + 52, height: Math.max(200, vp.height - 52) }}>
      <button className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2 text-left" onClick={() => props.onListing(thread.listingId)}>
        <div className="size-9 shrink-0 overflow-hidden rounded-lg bg-surface-2">{thread.photo ? <img src={thread.photo} alt="" className="size-full object-cover" /> : <Home className="m-auto mt-2 text-dim" size={18} />}</div>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-ink">{thread.title}</div>
          <div className="truncate text-[12px] text-dim">
            {thread.locality} · {thread.role === "guest" ? "переписка с хозяином" : `гость: ${thread.otherName}`}
          </div>
        </div>
      </button>

      <div ref={scroller} className="flex-1 overflow-y-auto overscroll-contain px-2.5 py-3">
        {rows.length === 0 && (
          <div className="mx-auto mt-10 max-w-[280px] rounded-2xl bg-black/25 px-4 py-3 text-center text-[13px] text-white">
            <MessageCircle className="mx-auto mb-1" size={20} />
            {thread.role === "guest" ? "Спросите хозяина о заселении, парковке или о чём угодно. Ответ придёт сюда и в чат с ботом." : "Сообщений пока нет."}
          </div>
        )}
        <ul>
          {rows.map((r, i) => {
            const prev = rows[i - 1];
            const next = rows[i + 1];
            const newDay = !prev || dayKey(prev.at) !== dayKey(r.at);
            const lastInGroup = !next || next.own !== r.own || dayKey(next.at) !== dayKey(r.at);
            return (
              <li key={r.key}>
                {newDay && (
                  <div className="my-2 flex justify-center">
                    <span className="rounded-full bg-black/25 px-2.5 py-0.5 text-[12px] font-medium text-white">{dayLabel(r.at)}</span>
                  </div>
                )}
                <div className={`flex ${r.own ? "justify-end" : "justify-start"} ${lastInGroup ? "mb-2" : "mb-0.5"}`}>
                  <div
                    className={`relative max-w-[80%] px-2.5 pt-1.5 pb-1 text-[15px] leading-snug shadow-[0_1px_1px_rgb(0_0_0/0.08)] ${
                      r.own ? `bg-[#dcf0ff] text-ink ${lastInGroup ? "rounded-[16px] rounded-br-[4px]" : "rounded-[16px]"}` : `bg-surface text-ink ${lastInGroup ? "rounded-[16px] rounded-bl-[4px]" : "rounded-[16px]"}`
                    } ${r.deleted ? "italic text-dim" : ""} ${r.state === "sending" ? "opacity-80" : ""}`}
                    // Своё сообщение: нажать → «Удалить у всех»
                    onClick={() => r.msg && r.own && !r.deleted && removeMsg(r.msg)}
                  >
                    <span className="whitespace-pre-wrap break-words">{r.deleted ? "Сообщение удалено" : r.text}</span>
                    {/* Время и галочка — в углу, как в Telegram: «невидимый» хвост в тексте оставляет им место */}
                    <span className="invisible ml-2 inline-block w-[52px]" aria-hidden />
                    <span className={`absolute right-2 bottom-1 flex items-center gap-0.5 text-[11px] ${r.own ? "text-accent/70" : "text-dim"}`}>
                      {timeOnly(r.at)}
                      {r.own && !r.deleted && (r.state === "sending" ? <Clock3 size={12} /> : r.state === "failed" ? <AlertCircle size={12} className="text-bad" /> : <Check size={13} />)}
                    </span>
                  </div>
                </div>
                {r.state === "failed" && r.out && (
                  <div className="-mt-1 mb-2 flex justify-end">
                    <button className="flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[12px] font-semibold text-bad shadow-sm" onClick={() => deliver(r.out!)}>
                      <RotateCw size={12} /> Не отправлено. Повторить
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {note && <p className="shrink-0 bg-surface px-4 pt-2 text-[12px] text-dim">{note}</p>}
      <form
        className="flex shrink-0 items-end gap-2 bg-surface px-2.5 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          sendMsg();
        }}
      >
        <textarea
          ref={input}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-[20px] border border-line bg-bg px-3.5 py-2 text-[15px] text-ink outline-none focus:border-accent"
          rows={1}
          maxLength={1000}
          placeholder="Сообщение"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Поле растёт вместе с текстом (до 5 строк), как в мессенджерах
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
          }}
          onFocus={() => setTimeout(() => scroller.current?.scrollTo({ top: 1e9 }), 250)}
          aria-label="Сообщение"
        />
        <button className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white transition-opacity disabled:opacity-40" disabled={!text.trim()} aria-label="Отправить">
          <SendHorizontal size={18} />
        </button>
      </form>
    </div>
  );
}

const dayKey = (ms: number) => new Date(ms + 4 * 3600e3).toISOString().slice(0, 10);
const timeOnly = (ms: number) => new Date(ms).toLocaleTimeString("ru-RU", { timeZone: "Europe/Samara", hour: "2-digit", minute: "2-digit" });
function dayLabel(ms: number) {
  const k = dayKey(ms);
  const today = dayKey(Date.now());
  if (k === today) return "Сегодня";
  if (k === dayKey(Date.now() - 86_400_000)) return "Вчера";
  return new Date(ms).toLocaleDateString("ru-RU", { timeZone: "Europe/Samara", day: "numeric", month: "long" });
}

/**
 * Видимая часть экрана с учётом клавиатуры. На телефоне клавиатура «съедает» низ экрана, а браузер не всегда
 * сдвигает страницу — поэтому переписка сама подстраивает высоту под то, что реально видно
 */
function useVisualViewport() {
  const read = () => ({ height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0 });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const v = window.visualViewport;
    const on = () => setVp(read());
    v?.addEventListener("resize", on);
    v?.addEventListener("scroll", on);
    window.addEventListener("resize", on);
    return () => {
      v?.removeEventListener("resize", on);
      v?.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);
  return vp;
}

/** Список переписок (и как гостя, и как хозяина) — во вкладке «Моё» */
/** bare — внутри вкладки «Сообщения»: без заголовка и с пустым состоянием */
export function ThreadList(props: { onOpen: (id: string) => void; bare?: boolean }) {
  const [threads, setThreads] = useState<ThreadView[] | null>(null);
  useLive(() => api.chatList().then((r) => setThreads(r.threads), () => setThreads((x) => x ?? [])), 15000);
  if (!threads) return props.bare ? <p className="py-6 text-center text-dim">Загружаем…</p> : null;
  if (!threads.length) {
    return props.bare ? (
      <div className="card p-5 text-center text-[14px] text-dim">
        <MessageCircle className="mx-auto mb-2" size={22} />
        Здесь будут переписки с хозяевами и гостями.
      </div>
    ) : null;
  }
  return (
    <section className={props.bare ? "" : "mb-6"}>
      {!props.bare && (
        <h2 className="mb-2 flex items-center gap-2 text-[17px] font-bold text-ink">
          <MessageCircle size={17} /> Сообщения
        </h2>
      )}
      <ul className="card divide-y divide-line">
        {threads.map((t) => (
          <li key={t.id} className="flex items-center">
            <button className="flex min-w-0 flex-1 items-center gap-3 p-3 pr-1 text-left" onClick={() => props.onOpen(t.id)}>
              <div className="size-11 shrink-0 overflow-hidden rounded-lg bg-surface-2">{t.photo && <img src={t.photo} alt="" className="size-full object-cover" />}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold text-ink">{t.role === "owner" ? t.otherName : t.title}</span>
                  <span className="shrink-0 text-[12px] text-dim">{timeText(t.updatedAt)}</span>
                </div>
                <div className="truncate text-[13px] text-dim">
                  {t.role === "owner" ? `${t.title} · ` : ""}
                  {t.lastText}
                </div>
              </div>
              {t.unread > 0 && <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-white">{t.unread}</span>}
            </button>
            <button
              className="grid size-11 shrink-0 place-items-center text-dim"
              aria-label="Удалить переписку"
              onClick={async () => {
                if (!(await ask("Удалить переписку?", { text: "Она пропадёт только у вас. Если собеседник напишет снова, переписка вернётся.", ok: "Удалить", danger: true }))) return;
                try {
                  await api.chatHide(t.id);
                  setThreads((list) => list?.filter((x) => x.id !== t.id) ?? list);
                } catch (e) {
                  tell("Не получилось удалить", errorText(e));
                }
              }}
            >
              <Trash2 size={17} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
