// Только для разработки: тестовые объявления в локальной базе (server/.data), чтобы видеть экраны с наполнением.
// В облако не попадает. Запуск: node server/seed-dev.ts (при остановленном npm run api)
import { fileURLToPath } from "node:url";
import { seedDemo } from "./seed.ts";
import { fileStore } from "./store.ts";

const store = fileStore(fileURLToPath(new URL("./.data/db.json", import.meta.url)));
await seedDemo(store, { devUserId: Number(process.env.DEV_USER) || 1 });
console.log("ok: тестовые объявления, разработчик — главный");
