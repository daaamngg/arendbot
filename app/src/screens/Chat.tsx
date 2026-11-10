import { useEffect, useRef, useState } from "react";
import { Home, MessageCircle, SendHorizontal } from "lucide-react";
import { api, type ChatMsg, type ThreadView } from "../lib/api.ts";

// Переписка гостя с хозяином до брони. Сообщения дублируются в чат MAX, ответить можно и там.
// Контакты сервер прячет: сделка остаётся на площадке, гость защищён от «переведите на карту»

const timeText = (ms: number) => new Date(ms).toLocaleString("ru-RU", { timeZone: "Europe/Samara", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });

/** listingId — гость открывает переписку из объявления; id — открыть существующую */
export function ChatScreen(props: { id?: string; listingId?: string; onListing: (id: string) => void }) {
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
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

  // Новые сообщения подтягиваем раз в 4 секунды, пока экран открыт
  useEffect(() => {
    if (!thread) return;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      api.chatThread(thread.id).then((r) => setMessages(r.messages), () => {});
    }, 4000);
    return () => clearInterval(t);
  }, [thread]);

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [messages.length]);

  if (failed) return <p className="text-bad">Переписка недоступна: объявление снято или ссылка устарела.</p>;
  if (!thread) return null;

  const sendMsg = async () => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api.chatSend(thread.id, v);
      setText("");
      if (r.masked) setNote("Телефоны и ссылки в сообщениях скрываются. Номер появится, когда бронь подтвердят.");
      const fresh = await api.chatThread(thread.id);
      setMessages(fresh.messages);
    } catch {
      setNote("Не получилось отправить. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
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

      {messages.length === 0 && (
        <div className="py-8 text-center text-[14px] text-dim">
          <MessageCircle className="mx-auto mb-2" />
          {thread.role === "guest" ? "Спросите хозяина о заселении, парковке или о чём угодно. Ответ придёт сюда и в чат с ботом." : "Сообщений пока нет."}
        </div>
      )}
      <ul className="space-y-2 pb-2">
        {messages.map((m) => (
          <li key={m.id} className={`flex ${mine(m) ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-[15px] ${mine(m) ? "rounded-br-md bg-accent text-white" : "rounded-bl-md border border-line bg-surface text-ink"}`}>
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
              <div className={`mt-0.5 text-right text-[11px] ${mine(m) ? "text-white/70" : "text-dim"}`}>{timeText(m.createdAt)}</div>
            </div>
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
          <button className="btn btn-main size-11 min-h-0 shrink-0 p-0" disabled={!text.trim() || busy} aria-label="Отправить">
            <SendHorizontal size={19} />
          </button>
        </form>
      </div>
    </>
  );
}

/** Список переписок (и как гостя, и как хозяина) — во вкладке «Моё» */
export function ThreadList(props: { onOpen: (id: string) => void }) {
  const [threads, setThreads] = useState<ThreadView[]>([]);
  useEffect(() => {
    api.chatList().then((r) => setThreads(r.threads), () => {});
  }, []);
  if (!threads.length) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-2 text-[17px] font-bold text-ink">
        <MessageCircle size={17} /> Сообщения
      </h2>
      <ul className="card divide-y divide-line">
        {threads.map((t) => (
          <li key={t.id}>
            <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => props.onOpen(t.id)}>
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
          </li>
        ))}
      </ul>
    </section>
  );
}
