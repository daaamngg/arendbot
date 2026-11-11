import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, LogOut, ShieldCheck } from "lucide-react";
import { ApiError, api, setAdminToken, type Me } from "./lib/api.ts";
import { AdminScreen } from "./screens/Admin.tsx";
import { Spinner } from "./ui/ui.tsx";
import { DialogHost, ask } from "./ui/dialog.tsx";

// Отдельная админка. Вход: «Получить код» → отправить код боту в MAX → бот спрашивает «Это вы?» → «Да».
// Дальше вход запоминается на этом устройстве, пока не нажать «Выйти» (или /logout_all боту).

const KEY = "arenda-admin-token";
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const save = (t: string | null) => {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* приватный режим: вход проживёт до закрытия вкладки */
  }
};

/** Чем назвать устройство в сообщении бота: «Windows, Chrome» / «Android, MAX» */
function deviceName() {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "устройство";
  const app = /YaBrowser/i.test(ua) ? "Яндекс Браузер" : /Edg\//i.test(ua) ? "Edge" : /Firefox/i.test(ua) ? "Firefox" : /Chrome/i.test(ua) ? "Chrome" : /Safari/i.test(ua) ? "Safari" : "браузер";
  return `${os}, ${app}`;
}

export default function AdminApp() {
  const [token, setToken] = useState<string | null>(() => {
    const t = read();
    setAdminToken(t);
    return t;
  });
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);

  const signOut = (all = false) => {
    api.adminLogout(all).catch(() => {});
    save(null);
    setAdminToken(null);
    setToken(null);
    setMe(null);
  };

  useEffect(() => {
    if (!token) return;
    setFailed(false);
    api.me().then(
      (m) => (m.admin ? setMe(m) : signOut()),
      (e) => {
        // Ключ больше не действует (вышли везде или убрали из команды) — снова вход по коду
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) signOut();
        else setFailed(true);
      },
    );
  }, [token]);

  if (!token) {
    return (
      <Login
        onDone={(t) => {
          save(t);
          setAdminToken(t);
          setToken(t);
        }}
      />
    );
  }
  if (failed) {
    return (
      <Frame>
        <p className="font-semibold text-ink">Сервер не ответил</p>
        <p className="mt-1 text-[14px] text-dim">Проверьте интернет и обновите страницу.</p>
      </Frame>
    );
  }
  if (!me) return <Spinner />;
  return (
    <div className="mx-auto min-h-dvh max-w-[720px] px-4 pt-3 pb-10">
      <header className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-dim">
          <ShieldCheck size={16} className="text-accent" /> {me.user.name ?? "Команда"} · {me.owner ? "главный" : "модератор"}
        </div>
        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-[14px] font-semibold text-dim">
            <LogOut size={16} /> Выйти
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-56 card p-1 text-[14px] shadow-[0_4px_16px_rgb(0_0_0/0.08)]">
            <button className="block w-full rounded-md px-3 py-2.5 text-left text-ink hover:bg-surface-2" onClick={() => signOut()}>
              Выйти на этом устройстве
            </button>
            <button className="block w-full rounded-md px-3 py-2.5 text-left text-bad hover:bg-surface-2" onClick={async () => (await ask("Выйти на всех устройствах?", { text: "Чтобы снова войти, понадобится новый код из бота.", ok: "Выйти везде", danger: true })) && signOut(true)}>
              Выйти на всех устройствах
            </button>
          </div>
        </details>
      </header>
      <AdminScreen owner={me.owner} />
      <DialogHost />
    </div>
  );
}

function Frame(props: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center px-5 py-10">
      <div className="mb-5 flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-accent text-white" aria-hidden>
          <ShieldCheck size={20} />
        </span>
        <span className="leading-tight">
          <span className="block text-[17px] font-bold text-ink">Админка</span>
          <span className="block text-[13px] text-dim">Посуточно · Самара и область</span>
        </span>
      </div>
      {props.children}
    </div>
  );
}

type Step = { kind: "idle" } | { kind: "code"; id: string; secret: string; code: string; expiresAt: number; bot: string | null; asked: boolean } | { kind: "error"; text: string };

/** Экран входа: код для бота, страница сама ждёт подтверждения */
function Login(props: { onDone: (token: string) => void }) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const stepRef = useRef(step);
  stepRef.current = step;

  const getCode = async () => {
    setBusy(true);
    try {
      const r = await api.adminLoginStart(deviceName());
      setStep({ kind: "code", ...r, asked: false });
    } catch {
      setStep({ kind: "error", text: "Не получилось получить код. Проверьте интернет и попробуйте ещё раз." });
    } finally {
      setBusy(false);
    }
  };

  // Ждём подтверждения в боте: спрашиваем сервер каждые 2 секунды
  useEffect(() => {
    if (step.kind !== "code") return;
    const t = setInterval(async () => {
      const s = stepRef.current;
      if (s.kind !== "code") return;
      setLeft(Math.max(0, Math.round((s.expiresAt - Date.now()) / 1000)));
      try {
        const r = await api.adminLoginCheck(s.id, s.secret);
        if (r.state === "approved" && r.token) props.onDone(r.token);
        else if (r.state === "denied") setStep({ kind: "error", text: "Вход отменён в боте." });
        else if (r.state === "expired" || r.state === "used") setStep({ kind: "error", text: "Код устарел. Получите новый." });
        else if (r.state === "asked" && !s.asked) setStep({ ...s, asked: true });
      } catch {
        /* сеть мигнула — спросим через 2 секунды */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [step.kind === "code" ? step.id : ""]);

  return (
    <Frame>
      {step.kind !== "code" ? (
        <>
          <h1 className="text-[22px] leading-tight font-bold text-ink">Вход для команды</h1>
          <p className="mt-2 text-[15px] text-dim">Нажмите кнопку, отправьте код боту площадки в MAX и подтвердите вход. Пароль запоминать не нужно.</p>
          {step.kind === "error" && (
            <p className="mt-4 rounded-lg bg-[#f5e1dd] px-3 py-2 text-[14px] text-bad" role="alert">
              {step.text}
            </p>
          )}
          <button className="btn btn-main mt-5 w-full" onClick={getCode} disabled={busy}>
            {busy ? "Получаем…" : "Получить код"}
          </button>
        </>
      ) : (
        <>
          <h1 className="text-[22px] leading-tight font-bold text-ink">{step.asked ? "Подтвердите в боте" : "Отправьте код боту"}</h1>
          <button
            className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl border border-line bg-surface py-5 text-[40px] font-bold tracking-[0.18em] text-ink tabular-nums"
            onClick={() => {
              navigator.clipboard?.writeText(step.code).then(() => setCopied(true), () => {});
            }}
            aria-label={`Код ${step.code}, нажмите, чтобы скопировать`}
          >
            {step.code}
            <Copy size={20} className="text-dim" />
          </button>
          <p className="mt-2 text-center text-[13px] text-dim">{copied ? "Скопировано" : "Нажмите на код, чтобы скопировать"}</p>
          <ol className="mt-5 space-y-2 text-[15px] text-ink">
            <li className={step.asked ? "text-dim line-through" : ""}>1. Отправьте эти 6 цифр боту площадки в MAX.</li>
            <li className={step.asked ? "font-semibold" : ""}>2. Бот спросит «Это вы?». Нажмите «Да, это я».</li>
            <li>3. Админка откроется здесь сама.</li>
          </ol>
          {step.bot && (
            <a className="btn btn-soft mt-5 w-full" href={`https://max.ru/${step.bot}`} target="_blank" rel="noopener noreferrer">
              Открыть бота в MAX
            </a>
          )}
          <p className="mt-4 text-center text-[13px] text-dim">{left > 0 ? `Код действует ещё ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Ждём подтверждения…"}</p>
        </>
      )}
    </Frame>
  );
}
