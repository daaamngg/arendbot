import { useState } from "react";
import { type SupportTicket } from "../../../shared/types.ts";
import { api, errorText } from "../lib/api.ts";
import { useLive } from "../lib/live.ts";
import { H1, Spinner } from "../ui/ui.tsx";

// Поддержка: человек пишет команде площадки. Обращение уходит в админку (раздел «Обращения»),
// ответ приходит сюда и сообщением от бота
const when = (ms: number) => new Date(ms).toLocaleString("ru-RU", { timeZone: "Europe/Samara", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function SupportScreen() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [list, setList] = useState<SupportTicket[] | null>(null);
  const load = () => api.supportMy().then((r) => setList(r.tickets), () => setList((x) => x ?? []));
  useLive(load, 20000);

  const send = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.supportSend(text);
      setList((x) => [r.ticket, ...(x ?? [])]);
      setText("");
      setMsg("Отправлено. Ответ придёт сюда и сообщением от бота.");
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <H1 sub="Вопрос, проблема с бронью или с хозяином — напишите, команда площадки ответит.">Поддержка</H1>
      <div className="card p-4">
        <textarea
          className="field min-h-[112px] resize-none"
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Опишите, что случилось"
          aria-label="Текст обращения"
        />
        <button className="btn btn-main mt-3 w-full" disabled={busy || text.trim().length < 5} onClick={send}>
          Отправить
        </button>
        {msg && <p className="mt-3 text-[14px] text-dim">{msg}</p>}
      </div>

      <h2 className="mt-6 mb-2 text-[17px] font-bold text-ink">Мои обращения</h2>
      {!list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="text-[14px] text-dim">Пока не было.</p>
      ) : (
        <ul className="space-y-3">
          {list.map((t) => (
            <li key={t.id} className="card px-4 py-3.5 text-[14px]">
              <div className="text-[12px] text-dim">{when(t.createdAt)}</div>
              <p className="mt-1 whitespace-pre-line text-ink">{t.text}</p>
              {t.reply ? (
                <div className="mt-3 rounded-lg bg-accent-soft px-3 py-2.5">
                  <div className="text-[12px] font-semibold text-accent">Ответ поддержки</div>
                  <p className="mt-0.5 whitespace-pre-line text-ink">{t.reply}</p>
                </div>
              ) : (
                <div className="mt-2 text-[13px] text-dim">{t.closed ? "Закрыто" : "Ждёт ответа"}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
