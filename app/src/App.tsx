import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, type Me, type SearchQuery } from "./lib/api.ts";
import { useLive } from "./lib/live.ts";
import { bindBackButton, startParam } from "./lib/max.ts";
import { AdminScreen } from "./screens/Admin.tsx";
import { ChatScreen } from "./screens/Chat.tsx";
import { ListingScreen, SearchScreen, TripsScreen } from "./screens/Guest.tsx";
import { HostCalendar, HostForm, HostHome } from "./screens/Host.tsx";
import { Shell, Spinner, type Tab } from "./ui/ui.tsx";
import { DialogHost, askText, tell } from "./ui/dialog.tsx";

// Навигация: вкладка + стек вложенных экранов. «Назад» MAX снимает верхний экран
type Screen =
  | { name: "listing"; id: string }
  | { name: "edit"; id: string | null }
  | { name: "calendar"; id: string }
  | { name: "chat"; id?: string; listingId?: string };

const TITLES: Record<Screen["name"], string> = { listing: "Жильё", edit: "Объявление", calendar: "Календарь", chat: "Переписка" };

/** Параметр ссылки из бота: host, admin, chat_<id> (кнопка «Открыть переписку» в уведомлении) */
const sp = startParam();
const initialTab: Tab = sp === "host" ? "host" : sp === "admin" ? "admin" : sp.startsWith("chat_") ? "trips" : "search";
const initialStack: Screen[] = sp.startsWith("chat_") ? [{ name: "chat", id: sp.slice(5) }] : [];

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [stack, setStack] = useState<Screen[]>(initialStack);
  const [query, setQuery] = useState<SearchQuery>({ guests: 1 });

  const refreshMe = useCallback(() => api.me().then(setMe, () => setFailed(true)), []);
  useEffect(() => {
    refreshMe();
  }, [refreshMe]);
  // Значок непрочитанных и статус заявки хозяина обновляются сами (тихо, без экрана ошибки)
  useLive(() => (me ? api.me().then(setMe) : undefined), 30000, [!!me]);

  // Кнопка «Назад» телефона. Раньше у приложения не было своей истории — «Назад» сразу закрывал его.
  // Теперь каждый вложенный экран и переход с «Поиска» на другую вкладку — шаг в истории браузера:
  // «Назад» закрывает экран, потом возвращает на «Поиск», и только потом выходит из приложения
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const depth = useRef(0);
  useEffect(() => {
    history.replaceState({ app: 0 }, "");
    // Открыли сразу на вкладке «Сдать»/«Админ» или в переписке — даём шаг назад к «Поиску»
    if (initialTab !== "search" || initialStack.length) {
      history.pushState({ app: 1 }, "");
      depth.current = 1;
    }
    const onPop = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (stackRef.current.length) {
        setStack((st) => st.slice(0, -1));
        // Вернулись из переписки — значок непрочитанных мог измениться
        api.me().then(setMe, () => {});
      } else if (tabRef.current !== "search") setTab("search");
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const push = (s: Screen) => {
    history.pushState({ app: 1 }, "");
    depth.current++;
    setStack((st) => [...st, s]);
    window.scrollTo({ top: 0 });
  };
  // Кнопки «Назад» на экране и в шапке MAX идут через историю — так она не расходится с экранами
  const back = useCallback(() => {
    if (depth.current > 0) return history.back();
    // Своих шагов в истории нет — возвращаемся без браузера, иначе кнопка «Назад» молча ничего не делает
    if (stackRef.current.length) setStack((st) => st.slice(0, -1));
    else if (tabRef.current !== "search") setTab("search");
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => bindBackButton(stack.length > 0 || tab !== "search", back), [stack.length, tab, back]);

  const onPhone = (phone: string) => setMe((m) => (m ? { ...m, user: { ...m.user, phone, consent: true } } : m));

  if (failed) {
    // Не висим на загрузке: сервер не ответил — объясняем и даём повторить
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-[16px] font-semibold text-ink">Не получилось загрузить</p>
        <p className="text-[14px] text-dim">Проверьте интернет. Если не помогло, откройте приложение заново из чата с ботом в MAX.</p>
        <button
          className="btn btn-main mt-2"
          onClick={() => {
            setFailed(false);
            refreshMe();
          }}
        >
          Повторить
        </button>
      </div>
    );
  }
  if (!me) return <Spinner />;

  const top = stack[stack.length - 1];
  const openListing = (id: string) => push({ name: "listing", id });
  let content;
  if (top?.name === "listing") {
    content = (
      <ListingScreen
        me={me}
        id={top.id}
        query={query}
        onPhone={onPhone}
        onChat={(listingId) => push({ name: "chat", listingId })}
        onBooked={() => {
          setStack([]);
          setTab("trips");
        }}
      />
    );
  } else if (top?.name === "chat") {
    content = <ChatScreen id={top.id} listingId={top.listingId} onListing={openListing} />;
  } else if (top?.name === "edit") {
    content = (
      <HostForm
        me={me}
        id={top.id}
        // Новое объявление получило id после первого сохранения — дальше правим его же
        onSaved={(id) => setStack((st) => [...st.slice(0, -1), { name: "edit", id }])}
        onDone={() => setStack([])}
      />
    );
  } else if (top?.name === "calendar") {
    content = <HostCalendar id={top.id} />;
  } else if (tab === "search") {
    content = <SearchScreen me={me} query={query} onQuery={setQuery} onOpen={openListing} />;
  } else if (tab === "trips") {
    content = <TripsScreen onOpen={openListing} onChat={(id) => push({ name: "chat", id })} unread={me.unread} />;
  } else if (tab === "host") {
    content = <HostHome me={me} onPhone={onPhone} onEdit={(id) => push({ name: "edit", id })} onCalendar={(id) => push({ name: "calendar", id })} />;
  } else if (tab === "admin" && me.admin) {
    // Админка — только у команды: вкладка появляется после кода, у обычного человека её нет вовсе
    content = <AdminScreen owner={me.owner} />;
  } else {
    content = <SearchScreen me={me} query={query} onQuery={setQuery} onOpen={openListing} />;
  }

  return (
    <Shell
      tab={tab}
      onTab={(t) => {
        // С «Поиска» на другую вкладку — шаг в истории (чтобы «Назад» вернул на поиск, а не закрыл приложение)
        if (tab === "search" && t !== "search" && !stack.length) {
          history.pushState({ app: 1 }, "");
          depth.current++;
        }
        setTab(t);
        setStack([]);
        window.scrollTo({ top: 0 });
        refreshMe();
      }}
      admin={me.admin}
      owner={me.owner}
      unread={me.unread}
      onBack={top ? back : undefined}
      // Только демо: 5 нажатий на логотип — поле для кода команды (в настоящем боте код просто отправляют боту)
      onLogo={me.demo ? () => demoCode(refreshMe) : undefined}
      title={top ? TITLES[top.name] : undefined}
    >
      {content}
      <DialogHost />
    </Shell>
  );
}

/** Только демо (бота нет): код команды вводят здесь. В MAX код отправляют сообщением боту — как в калькуляторе */
async function demoCode(done: () => void) {
  const code = await askText("Код команды", "", { text: "Только для проверки в демо. В настоящем боте пароль отправляют сообщением боту.", ok: "Войти", placeholder: "Пароль" });
  if (!code) return;
  try {
    const r = await api.demoCode(code);
    tell(r.role === "owner" ? "Вы главный" : "Вы модератор", "Внизу появилась вкладка админки.");
    done();
  } catch (e) {
    tell("Не получилось", errorText(e));
  }
}
