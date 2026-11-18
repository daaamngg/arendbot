import { useEffect, useRef, useState } from "react";

// Свои окна вместо confirm / alert / prompt браузера. Во встроенном браузере MAX системные окна
// часто не показываются: confirm() сразу возвращает «нет» — и кнопки вроде «Удалить из списка» молча
// ничего не делали. Здесь окно рисуется самим приложением и работает везде.

interface Req {
  title: string;
  text?: string;
  ok?: string;
  cancel?: string | null;
  danger?: boolean;
  /** поле ввода (причина отказа и т. п.): ответ — строка или null */
  input?: { value: string; placeholder?: string };
  resolve: (v: boolean | string | null) => void;
}

let push: ((r: Req) => void) | null = null;

// «Назад» телефона (и кнопка «Назад» MAX) при открытом окне закрывает окно, а не экран под ним.
// Открылось окно — кладём в историю свой шаг; «Назад» снимает его, App спрашивает dialogTookBack() и экран не трогает.
// Закрыли кнопкой — свой шаг убираем сами (чуть позже: вдруг сразу откроется следующее окно, тогда шаг общий)
let pushed = false;
let skipPop = 0;
let backTimer: ReturnType<typeof setTimeout> | undefined;
let cancelTop: (() => void) | null = null;

/** Вызывает App в начале обработки «Назад»: true — это было про окно, экран не менять */
export function dialogTookBack(): boolean {
  if (skipPop > 0) {
    skipPop--;
    return true;
  }
  if (pushed && cancelTop) {
    pushed = false;
    cancelTop();
    return true;
  }
  return false;
}

const open = (r: Omit<Req, "resolve">) =>
  new Promise<boolean | string | null>((resolve) => {
    if (push) push({ ...r, resolve });
    // Окно ещё не смонтировано (не должно случаться) — не блокируем человека
    else resolve(r.input ? r.input.value : true);
  });

/** «Вы уверены?» → true / false */
export const ask = (title: string, opts: { text?: string; ok?: string; cancel?: string; danger?: boolean } = {}) => open({ title, ...opts }) as Promise<boolean>;
/** Сообщение с одной кнопкой «Понятно» */
export const tell = (title: string, text?: string) => open({ title, text, ok: "Понятно", cancel: null }).then(() => undefined);
/** Вопрос с полем ввода → текст или null (отмена) */
export const askText = (title: string, value = "", opts: { text?: string; ok?: string; danger?: boolean; placeholder?: string } = {}) =>
  open({ title, text: opts.text, ok: opts.ok, danger: opts.danger, input: { value, placeholder: opts.placeholder } }) as Promise<string | null>;

/** Ставится один раз в корень приложения */
export function DialogHost() {
  const [queue, setQueue] = useState<Req[]>([]);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    push = (r) => setQueue((q) => [...q, r]);
    return () => {
      push = null;
    };
  }, []);
  const cur = queue[0];
  const close = (v: boolean | string | null, fromBack = false) => {
    if (!cur) return;
    cur.resolve(v);
    setQueue((q) => q.slice(1));
    if (!fromBack && pushed) {
      backTimer = setTimeout(() => {
        if (pushed && !cancelTop) {
          pushed = false;
          skipPop++;
          history.back();
        }
      }, 80);
    }
  };
  useEffect(() => {
    if (cur?.input) {
      setValue(cur.input.value);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    if (cur) {
      clearTimeout(backTimer);
      if (!pushed) {
        history.pushState({ dialog: 1 }, "");
        pushed = true;
      }
      cancelTop = () => close(cur.input ? null : false, true);
    } else cancelTop = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);
  if (!cur) return null;
  const okDisabled = !!cur.input && !value.trim();
  // «Заблокировать и удалить» в половину ширины не влезает — тогда кнопки во всю ширину, одна под другой
  const stacked = cur.cancel === null || (cur.ok ?? "").length > 12 || (cur.cancel ?? "").length > 12;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={cur.title} onClick={() => cur.cancel !== null && close(cur.input ? null : false)}>
      <div className="w-full max-w-[420px] rounded-2xl bg-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="text-[17px] font-bold text-ink">{cur.title}</div>
        {cur.text && <p className="mt-1.5 text-[14px] text-dim">{cur.text}</p>}
        {cur.input && (
          <textarea ref={inputRef} className="field mt-3 resize-none" rows={2} maxLength={300} value={value} placeholder={cur.input.placeholder} onChange={(e) => setValue(e.target.value)} />
        )}
        <div className={`mt-4 gap-2 ${stacked ? "flex flex-col-reverse" : "grid grid-cols-2"}`}>
          {cur.cancel !== null && (
            <button className="btn btn-line px-4 text-center leading-tight" onClick={() => close(cur.input ? null : false)}>
              {cur.cancel ?? "Отмена"}
            </button>
          )}
          <button className={`btn px-4 text-center leading-tight ${cur.danger ? "bg-bad text-white" : "btn-main"}`} disabled={okDisabled} onClick={() => close(cur.input ? value.trim() : true)}>
            {cur.ok ?? "Да"}
          </button>
        </div>
      </div>
    </div>
  );
}
