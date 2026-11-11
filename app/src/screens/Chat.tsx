import { useEffect, useRef, useState } from "react";
import { Home, MessageCircle, RotateCw, SendHorizontal, Trash2 } from "lucide-react";
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
  const bottom = useRef<HTMLDivElement>(null);

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

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [messages.length, outbox.length]);

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
    const o: Outgoing = { key: newKey(), text: v, createdAt: Date.now(), state: "sending" };
    setOutbox((list) => [...list, o]);
    deliver(o);
  };

  const mine = (m: ChatMsg) => m.from === thread.role;
  return (
    <>
      <button className="card -mt-1 mb-4 flex w-full items-center gap-3 p-2.5 text-left" onClick={() => props.onListing(thread.listingId)}>
        <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-surface-2">{thread.photo ? <img src={thread.photo} alt="" className="size-full object-cover" /> : <Home className="m-auto mt-3 text-dim" />}</div>
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink">{thread.title}</div>
          <div className="text-[13px] text-dim">
            {thread.locality} · {thread.role === "guest" ? "переписка с хозяином" : `гость: ${thread.otherName}`}
          </div>
        </div>
      </button>

      {messages.length === 0 && outbox.length === 0 && (
        <div className="py-8 text-center text-[14px] text-dim">
          <MessageCircle className="mx-auto mb-2" />
          {thread.role === "guest" ? "Спросите хозяина о заселении, парковке или о чём угодно. Ответ придёт сюда и в чат с ботом." : "Сообщений пока нет."}
        </div>
      )}
      <ul className="space-y-2 pb-2">
        {messages.map((m) => (
          <li key={m.id} className={`flex ${mine(m) ? "justify-end" : "justify-start"}`}>
            {/* Своё сообщение: нажать → «Удалить у всех». Удалённое показывается серой строкой */}
            <div
              className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-[15px] ${m.deleted ? "border border-dashed border-line text-dim italic" : mine(m) ? "cursor-pointer rounded-br-md bg-accent text-white" : "rounded-bl-md border border-line bg-surface text-ink"}`}
              onClick={() => mine(m) && !m.deleted && removeMsg(m)}
            >
              <div className="whitespace-pre-wrap break-words">{m.deleted ? "Сообщение удалено" : m.text}</div>
              <div className={`mt-0.5 text-right text-[11px] ${mine(m) && !m.deleted ? "text-white/70" : "text-dim"}`}>{timeText(m.createdAt)}</div>
            </div>
          </li>
        ))}
        {outbox.map((o) => (
          <li key={o.key} className="flex flex-col items-end">
            <div className={`max-w-[82%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[15px] text-white ${o.state === "sending" ? "opacity-70" : ""}`}>
              <div className="whitespace-pre-wrap break-words">{o.text}</div>
              <div className="mt-0.5 text-right text-[11px] text-white/70">{o.state === "sending" ? "отправляется…" : "не отправлено"}</div>
            </div>
            {o.state === "failed" && (
              <button className="mt-1 flex items-center gap-1 text-[13px] font-semibold text-bad" onClick={() => deliver(o)}>
                <RotateCw size={13} /> Повторить
              </button>
            )}
          </li>
        ))}
      </ul>
      <div ref={bottom} />

      <div className="sticky bottom-0 -mx-4 mt-auto border-t border-line bg-bg px-4 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))]">
        {note && <p className="mb-2 text-[13px] text-dim">{note}</p>}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendMsg();
          }}
        >
          <textarea className="field max-h-32 min-h-11 flex-1 resize-none py-2.5" rows={1} maxLength={1000} placeholder="Сообщение" value={text} onChange={(e) => setText(e.target.value)} aria-label="Сообщение" />
          <button className="btn btn-main size-11 min-h-0 shrink-0 p-0" disabled={!text.trim()} aria-label="Отправить">
            <SendHorizontal size={19} />
          </button>
        </form>
      </div>
    </>
  );
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
