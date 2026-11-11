import { useEffect, useRef } from "react";

/**
 * Живые данные без перезагрузки страницы: вызывает load сразу, потом каждые ms миллисекунд,
 * пока экран открыт и приложение на виду. Вернулись в приложение (свернули и развернули) — обновляем сразу.
 * Запросы не накладываются: следующий не уходит, пока не ответил предыдущий
 */
export function useLive(load: () => Promise<unknown> | void, ms = 8000, deps: unknown[] = []) {
  const ref = useRef(load);
  ref.current = load;
  useEffect(() => {
    let busy = false;
    let alive = true;
    const run = async () => {
      if (busy || !alive || document.visibilityState !== "visible") return;
      busy = true;
      try {
        await ref.current();
      } catch {
        /* ошибку показывает сам экран; следующая попытка — по таймеру */
      } finally {
        busy = false;
      }
    };
    run();
    const t = setInterval(run, ms);
    const onShow = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}
