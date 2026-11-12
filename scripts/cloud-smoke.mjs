// Проверка облака после выкладки: запросы с настоящей подписью MAX (токен бота из .env.local, на экран не выводится).
// node --env-file=.env.local scripts/cloud-smoke.mjs <API_URL с ?p=>
import { signedInit } from "../server/selftest-init.ts";

const api = process.argv[2];
const token = process.env.MAX_BOT_TOKEN;
if (!api || !token) throw new Error("нужен API_URL и MAX_BOT_TOKEN");
const TEST_USER = 999_000_001; // тестовый человек, не настоящий из MAX
const call = async (path, body = {}) => {
  const t = performance.now();
  const r = await fetch(api + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.invalid" }, body: JSON.stringify({ ...body, initData: signedInit(token, TEST_USER, "Тест облака") }) });
  return { status: r.status, ms: Math.round(performance.now() - t), json: await r.json().catch(() => null), cors: r.headers.get("access-control-allow-origin") };
};
const me = await call("/me");
console.log("me:", me.status, me.ms + " мс", me.json?.user?.id === TEST_USER ? "человек создан в базе" : JSON.stringify(me.json));
const me2 = await call("/me");
console.log("me повторно:", me2.status, me2.ms + " мс (тёплый сервер)");
const s = await call("/search", { guests: 1 });
console.log("search:", s.status, s.ms + " мс", "объявлений:", s.json?.cards?.length);
const demo = await call("/demo/code", { code: "x" });
console.log("ввод кода в приложении в облаке закрыт:", demo.status === 404 ? "да" : `НЕТ (${demo.status})`);
console.log("CORS только для приложения:", me.cors);
