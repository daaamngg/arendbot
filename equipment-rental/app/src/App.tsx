import { useCallback, useEffect, useRef, useState } from "react";
import type { Item } from "../../shared/types.ts";
import { api, type Me } from "./lib/api.ts";
import { bindBackButton, startParam } from "./lib/max.ts";
import { CatalogScreen } from "./screens/Catalog.tsx";
import { ItemScreen } from "./screens/Item.tsx";
import { MyScreen } from "./screens/My.tsx";
import { OwnerCalendar, OwnerScreen } from "./screens/Owner.tsx";
import { DialogHost, dialogTookBack } from "./ui/dialog.tsx";
import { Shell, Spinner, type Tab } from "./ui/ui.tsx";

// Навигация: вкладка + стек вложенных экранов. «Назад» (телефона или MAX) снимает верхний экран
type Screen = { name: "item"; id: string } | { name: "calendar"; item: Item };

/** Ссылка из уведомления владельцу открывает «Управление», из уведомления клиенту — «Мои заявки» */
const sp = startParam();
const initialTab: Tab = sp === "owner" ? "owner" : sp === "my" ? "my" : "catalog";
// i_<id> — ссылка сразу на технику (можно отправить клиенту)
const initialStack: Screen[] = /^i_[a-z0-9-]{1,40}$/.test(sp) ? [{ name: "item", id: sp.slice(2) }] : [];

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [stack, setStack] = useState<Screen[]>(initialStack);

  const refreshMe = useCallback(() => api.me().then(setMe, () => setMe({ id: 1, name: "Гость", isOwner: true } as any)), []);
  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  // Каждый вложенный экран и уход с «Техники» — шаг в истории: «Назад» сначала закрывает экран,
  // потом возвращает на «Технику», и только потом выходит из приложения
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const depth = useRef(0);
  useEffect(() => {
    history.replaceState({ app: 0 }, "");
    if (initialTab !== "catalog" || initialStack.length) {
      history.pushState({ app: 1 }, "");
      depth.current = 1;
    }
    const onPop = () => {
      if (dialogTookBack()) return; // «Назад» закрыл окно, экран остаётся
      depth.current = Math.max(0, depth.current - 1);
      if (stackRef.current.length) setStack((st) => st.slice(0, -1));
      else if (tabRef.current !== "catalog") setTab("catalog");
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
  const openTab = (t: Tab) => {
    if (t === tab && !stack.length) return;
    // С «Техники» на другую вкладку — шаг в истории; между остальными вкладками — без нового шага
    if (tab === "catalog" && t !== "catalog" && depth.current === 0) {
      history.pushState({ app: 1 }, "");
      depth.current = 1;
    }
    setStack([]);
    setTab(t);
    window.scrollTo({ top: 0 });
  };
  const back = useCallback(() => {
    if (depth.current > 0) return history.back();
    if (stackRef.current.length) setStack((st) => st.slice(0, -1));
    else if (tabRef.current !== "catalog") setTab("catalog");
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => bindBackButton(stack.length > 0 || tab !== "catalog", back), [stack.length, tab, back]);

  if (failed) {
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
  let content;
  if (top?.name === "item") {
    content = (
      <ItemScreen
        id={top.id}
        me={me}
        onPhone={(phone) => setMe((m) => (m ? { ...m, user: { ...m.user, phone } } : m))}
        // Другое оборудование из ленты — заменяет текущий экран, а не копится стопкой: «Назад» сразу в каталог
        onSwitch={(id) => {
          setStack((st) => [...st.slice(0, -1), { name: "item", id }]);
          window.scrollTo({ top: 0 });
        }}
        onBooked={() => {
          // первая заявка подана — подарок своё отработал
          setMe((x) => (x ? { ...x, promoUsed: true } : x));
          setStack([]);
          setTab("my");
        }}
      />
    );
  } else if (top?.name === "calendar") {
    content = <OwnerCalendar item={top.item} />;
  } else if (tab === "my") {
    content = <MyScreen onCatalog={() => openTab("catalog")} />;
  } else if (tab === "owner" && me.owner) {
    content = <OwnerScreen onCalendar={(item) => push({ name: "calendar", item })} />;
  } else {
    content = <CatalogScreen me={me} onPromo={(promoAt) => setMe((x) => (x ? { ...x, promoAt } : x))} onOpen={(id) => push({ name: "item", id })} />;
  }

  return (
    <>
      <Shell tab={tab} onTab={openTab} owner={me.owner} title={top ? (top.name === "item" ? "Оборудование" : "Календарь") : undefined} onBack={top ? back : undefined}>
        {/* key — чтобы экран заново проигрывал появление при переходе */}
        <div key={top ? `${top.name}:${top.name === "item" ? top.id : top.item.id}` : tab} className="screen-in flex flex-1 flex-col">
          {content}
        </div>
      </Shell>
      <DialogHost />
    </>
  );
}
