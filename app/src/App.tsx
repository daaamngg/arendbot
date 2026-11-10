import { useCallback, useEffect, useState } from "react";
import { api, type Me, type SearchQuery } from "./lib/api.ts";
import { bindBackButton, startParam } from "./lib/max.ts";
import { AdminScreen } from "./screens/Admin.tsx";
import { ChatScreen } from "./screens/Chat.tsx";
import { ListingScreen, SearchScreen, TripsScreen } from "./screens/Guest.tsx";
import { HostCalendar, HostForm, HostHome } from "./screens/Host.tsx";
import { Shell, Spinner, type Tab } from "./ui/ui.tsx";

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

  const push = (s: Screen) => {
    setStack((st) => [...st, s]);
    window.scrollTo({ top: 0 });
  };
  const back = useCallback(() => {
    setStack((st) => st.slice(0, -1));
    window.scrollTo({ top: 0 });
    // Вернулись из переписки — значок непрочитанных мог измениться
    api.me().then(setMe, () => {});
  }, []);
  useEffect(() => bindBackButton(stack.length > 0, back), [stack.length, back]);

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
  } else {
    content = me.admin ? <AdminScreen owner={me.owner} /> : null;
  }

  return (
    <Shell
      tab={tab}
      onTab={(t) => {
        setTab(t);
        setStack([]);
        window.scrollTo({ top: 0 });
        refreshMe();
      }}
      admin={me.admin}
      owner={me.owner}
      unread={me.unread}
      onBack={top ? back : undefined}
      title={top ? TITLES[top.name] : undefined}
    >
      {content}
    </Shell>
  );
}
