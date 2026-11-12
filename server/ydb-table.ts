import { Metadata } from "@grpc/grpc-js";
import { Column, Driver, TableDescription, TableIndex, TypedValues, Types, getCredentialsFromEnv, type Session, type Ydb } from "ydb-sdk";
import type { DocRow, DocTable, DocTx, GField } from "./doc-store.ts";

// «Таблица документов» в YDB (облачная база Яндекса, serverless — платят за запросы, есть бесплатный лимит).
// Одна таблица docs: ключ (kind, id), поля поиска g1…g4 с синхронными индексами, data — JSON строкой.
// Вход в базу внутри облачной функции — по её сервисному аккаунту (YDB_METADATA_CREDENTIALS=1), без ключей в коде.
// Проверено только логикой (selftest на memoryTable); на живой базе — после создания платёжного аккаунта.

const TABLE = "docs";
const FIELDS: GField[] = ["g1", "g2", "g3", "g4"];
/** YDB отдаёт за раз не больше 1000 строк — читаем страницами по id */
const PAGE = 1000;

const utf8 = (v: string) => TypedValues.utf8(v);
const text = (rs: Ydb.IResultSet | undefined) => (rs?.rows ?? []).map((r) => r.items?.[0]?.textValue ?? "");
const idAndText = (rs: Ydb.IResultSet | undefined) => (rs?.rows ?? []).map((r) => [r.items?.[0]?.textValue ?? "", r.items?.[1]?.textValue ?? ""] as [string, string]);

/** Верхняя граница для префикса «abc:» — «abc;»: все id с этим началом лежат между ними */
const upper = (p: string) => (p ? p.slice(0, -1) + String.fromCharCode(p.charCodeAt(p.length - 1) + 1) : "");

type Run = (q: string, params: Record<string, Ydb.ITypedValue>) => Promise<Ydb.Table.ExecuteQueryResult>;

/** Операции, общие для обычного режима и транзакции: отличается только способ выполнить запрос */
function ops(run: Run): DocTx & { pages: (q: (after: string) => [string, Record<string, Ydb.ITypedValue>]) => Promise<[string, string][]> } {
  const pages = async (build: (after: string) => [string, Record<string, Ydb.ITypedValue>]) => {
    const out: [string, string][] = [];
    let after = "";
    for (;;) {
      const [q, p] = build(after);
      const rows = idAndText((await run(q, p)).resultSets?.[0]);
      out.push(...rows);
      if (rows.length < PAGE) return out;
      after = rows[rows.length - 1][0];
    }
  };
  return {
    pages,
    async get<T>(kind: string, id: string) {
      const r = await run(`DECLARE $k AS Utf8; DECLARE $id AS Utf8; SELECT data FROM ${TABLE} WHERE kind = $k AND id = $id;`, { $k: utf8(kind), $id: utf8(id) });
      const v = text(r.resultSets?.[0])[0];
      return v ? (JSON.parse(v) as T) : undefined;
    },
    async find<T>(kind: string, field: GField, value: string) {
      if (!FIELDS.includes(field)) throw new Error("bad field");
      const rows = await pages((after) => [
        `DECLARE $k AS Utf8; DECLARE $v AS Utf8; DECLARE $a AS Utf8;
         SELECT id, data FROM ${TABLE} VIEW idx_${field} WHERE kind = $k AND ${field} = $v AND id > $a ORDER BY id LIMIT ${PAGE};`,
        { $k: utf8(kind), $v: utf8(value), $a: utf8(after) },
      ]);
      return rows.map(([, d]) => JSON.parse(d) as T);
    },
    async put(row: DocRow) {
      await run(
        `DECLARE $k AS Utf8; DECLARE $id AS Utf8; DECLARE $g1 AS Utf8; DECLARE $g2 AS Utf8; DECLARE $g3 AS Utf8; DECLARE $g4 AS Utf8; DECLARE $d AS Utf8;
         UPSERT INTO ${TABLE} (kind, id, g1, g2, g3, g4, data) VALUES ($k, $id, $g1, $g2, $g3, $g4, $d);`,
        { $k: utf8(row.kind), $id: utf8(row.id), $g1: utf8(row.g1 ?? ""), $g2: utf8(row.g2 ?? ""), $g3: utf8(row.g3 ?? ""), $g4: utf8(row.g4 ?? ""), $d: utf8(JSON.stringify(row.data)) },
      );
    },
  };
}

/**
 * Вход в YDB токеном сервисного аккаунта функции из сервиса метаданных облака. Встроенный вход ydb-sdk
 * требует тяжёлую библиотеку @yandex-cloud/nodejs-sdk — обходимся одним запросом. Токен обновляем заранее
 */
function metadataAuth() {
  let token = "";
  let until = 0;
  return {
    async getAuthMetadata() {
      if (!token || Date.now() > until) {
        const r = await fetch("http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
        if (!r.ok) throw new Error(`метаданные: ${r.status}`);
        const j = (await r.json()) as { access_token: string; expires_in: number };
        token = j.access_token;
        until = Date.now() + Math.max(60, j.expires_in - 300) * 1000;
      }
      const md = new Metadata();
      md.add("x-ydb-auth-ticket", token);
      return md;
    },
  };
}

export async function ydbTable(connectionString: string): Promise<DocTable> {
  // В облаке (YDB_METADATA_CREDENTIALS=1) — свой вход по токену функции; иначе — как скажут переменные окружения
  const authService = process.env.YDB_METADATA_CREDENTIALS === "1" ? metadataAuth() : getCredentialsFromEnv();
  // ydb-sdk 5 читает «grpcs://хост/?database=/путь» неправильно (берёт путь «/»), поэтому переносим базу в путь
  const u = new URL(connectionString);
  const db = u.searchParams.get("database");
  const cs = db ? `${u.protocol}//${u.host}${db}` : connectionString;
  const driver = new Driver({ connectionString: cs, authService });
  if (!(await driver.ready(10_000))) throw new Error("YDB: нет соединения");
  const withSession = <T>(fn: (s: Session) => Promise<T>) => driver.tableClient.withSessionRetry(fn);

  // Таблица и индексы создаются сами при первом запуске
  await withSession(async (s) => {
    try {
      await s.describeTable(TABLE);
    } catch {
      const d = new TableDescription()
        .withColumn(new Column("kind", Types.optional(Types.UTF8)))
        .withColumn(new Column("id", Types.optional(Types.UTF8)))
        .withPrimaryKeys("kind", "id");
      for (const f of FIELDS) d.withColumn(new Column(f, Types.optional(Types.UTF8)));
      d.withColumn(new Column("data", Types.optional(Types.UTF8)));
      // Синхронные индексы: в транзакции брони поиск по объявлению видит только что записанное
      for (const f of FIELDS) d.withIndex(new TableIndex(`idx_${f}`).withIndexColumns("kind", f).withGlobalAsync(false));
      await s.createTable(TABLE, d);
    }
  });

  // Обычный режим: каждый запрос — своя короткая транзакция (повторяется сам при сбоях сети)
  const plain = ops((q, p) => withSession((s) => s.executeQuery(q, p)));

  const table: DocTable = {
    get: plain.get,
    find: plain.find,
    put: plain.put,
    async del(kind, id) {
      await withSession((s) => s.executeQuery(`DECLARE $k AS Utf8; DECLARE $id AS Utf8; DELETE FROM ${TABLE} WHERE kind = $k AND id = $id;`, { $k: utf8(kind), $id: utf8(id) }));
    },
    async all<T>(kind: string) {
      const rows = await plain.pages((after) => [
        `DECLARE $k AS Utf8; DECLARE $a AS Utf8; SELECT id, data FROM ${TABLE} WHERE kind = $k AND id > $a ORDER BY id LIMIT ${PAGE};`,
        { $k: utf8(kind), $a: utf8(after) },
      ]);
      return rows.map(([, d]) => JSON.parse(d) as T);
    },
    async prefix<T>(kind: string, p: string) {
      const hi = upper(p);
      const rows = await plain.pages((after) => [
        // $hi объявляем, только когда он есть: лишний объявленный параметр YDB не любит
        `DECLARE $k AS Utf8; DECLARE $p AS Utf8; ${hi ? "DECLARE $hi AS Utf8;" : ""} DECLARE $a AS Utf8;
         SELECT id, data FROM ${TABLE} WHERE kind = $k AND id >= $p ${hi ? "AND id < $hi" : ""} AND id > $a ORDER BY id LIMIT ${PAGE};`,
        { $k: utf8(kind), $p: utf8(p), $a: utf8(after), ...(hi ? { $hi: utf8(hi) } : {}) },
      ]);
      return rows.map(([id, d]) => [id, JSON.parse(d) as T] as [string, T]);
    },
    async tx<T>(fn: (t: DocTx) => Promise<T>) {
      // Одна сериализуемая транзакция. Если двое пишут одновременно (две брони на одни даты из разных копий сервера),
      // YDB отменяет вторую («locks invalidated» / «transaction not found»). Тогда выполняем её заново:
      // со свежими данными она увидит первую бронь и вернёт «занято». Проверено гонкой: 10 одновременных → прошла 1
      for (let attempt = 0; ; attempt++) {
        try {
          return await withSession(async (s) => {
            let txId: string | null = null;
            const t = ops(async (q, p) => {
              const r = await s.executeQuery(q, p, txId ? { txId } : { beginTx: { serializableReadWrite: {} }, commitTx: false });
              txId ??= r.txMeta?.id ?? null;
              return r;
            });
            const out = await fn(t);
            if (txId) await s.commitTransaction({ txId });
            return out;
          });
        } catch (e) {
          const m = String((e as Error)?.message ?? e);
          const conflict = /locks invalidated|transaction not found|aborted|ABORTED|2015/i.test(m);
          if (!conflict || attempt >= 8) throw e;
          // Небольшая случайная пауза, чтобы повторы не столкнулись снова
          await new Promise((r) => setTimeout(r, 30 + Math.random() * 120 * (attempt + 1)));
        }
      }
    },
  };
  return table;
}
