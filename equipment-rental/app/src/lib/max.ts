// Обёртка над мостом MAX (window.WebApp, скрипт st.max.ru/js/max-web-app.js).
// Вне MAX (обычный браузер при разработке) моста нет — всё работает, номер вводится вручную.

interface MaxContact {
  phone: string;
  authDate: number;
  hash: string;
}

interface MaxWebApp {
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string; last_name?: string }; start_param?: string };
  platform?: string;
  requestContact?: () => Promise<MaxContact>;
  openLink?: (url: string) => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred?: (style: "light" | "medium" | "heavy" | "soft" | "rigid") => void;
    selectionChanged?: () => void;
    notificationOccurred?: (type: "success" | "error" | "warning") => void;
  };
}

declare global {
  interface Window {
    WebApp?: MaxWebApp;
  }
}

const app = (): MaxWebApp | undefined => (window.WebApp?.initData ? window.WebApp : undefined);

export const inMax = () => app() != null;
/** Есть ли у этого клиента MAX своя кнопка «Назад» в шапке (на части версий её может не быть) */
export const hasNativeBack = () => typeof app()?.BackButton?.show === "function";
export const initData = () => app()?.initData ?? "";
export const maxUser = () => app()?.initDataUnsafe?.user;
/** Параметр из ссылки max.ru/<бот>?startapp=<...> — например «admin» из кнопки «Открыть заявки» */
// В обычном браузере (демо) тот же параметр можно передать в адресе: ?startapp=l_<id>
export const startParam = () => app()?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get("startapp") || "";

/** Внешняя ссылка: в MAX — через его браузер (иначе мини-приложение уйдёт со страницы и вернуться будет нельзя) */
export function openExternal(url: string) {
  const a = app();
  if (a?.openLink) a.openLink(new URL(url, location.href).href);
  else window.open(url, "_blank", "noopener");
}

/** Номер телефона одной кнопкой (окно MAX «Поделиться номером»). null — отказался или мы не в MAX. */
export async function requestContact(): Promise<MaxContact | null> {
  const a = app();
  if (!a?.requestContact) return null;
  try {
    // Окно MAX «Поделиться номером» иногда не появляется или не отвечает — тогда через 12 секунд
    // сдаёмся и показываем поле для ввода номера руками (раньше приложение ждало вечно и «зависало»)
    return await Promise.race([a.requestContact(), new Promise<null>((r) => setTimeout(() => r(null), 12_000))]);
  } catch {
    return null;
  }
}

export function haptic(kind: "tap" | "select" | "success" | "error") {
  const h = app()?.HapticFeedback;
  try {
    if (kind === "tap") h?.impactOccurred?.("light");
    else if (kind === "select") h?.selectionChanged?.();
    else h?.notificationOccurred?.(kind);
  } catch {
    /* вибро не обязательно */
  }
}

/** Кнопка «Назад» в шапке MAX. Возвращает функцию отписки. */
export function bindBackButton(visible: boolean, onBack: () => void): () => void {
  const b = app()?.BackButton;
  if (!b) return () => {};
  if (!visible) {
    b.hide();
    return () => {};
  }
  b.show();
  b.onClick(onBack);
  return () => b.offClick(onBack);
}
