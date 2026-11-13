// Уборка в облачной базе по просьбе Арслана: стереть историю действий команды и тестовых людей
// (номера от 900 000 000 — проверки облака). Настоящих людей, объявления и брони не трогает.
// YDB_ACCESS_TOKEN_CREDENTIALS=$(yc iam create-token) node scripts/cloud-cleanup.ts <YDB_CONNECTION> [--dry]
import { ydbTable } from "../server/ydb-table.ts";

const [conn, flag] = process.argv.slice(2);
const dry = flag === "--dry";
const t = await ydbTable(conn);
const audit = await t.prefix<unknown>("audit", "");
const users = (await t.all<{ id: number; name: string | null }>("user")).filter((u) => u.id >= 900_000_000);
console.log(`история действий: ${audit.length} записей; тестовые люди: ${users.map((u) => `${u.name ?? "без имени"} (${u.id})`).join(", ") || "нет"}`);
if (!dry) {
  for (const [id] of audit) await t.del("audit", id);
  for (const u of users) await t.del("user", String(u.id));
  console.log("стёрто");
}
process.exit(0);
