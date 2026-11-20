import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// «Таблица документов»: (вид, id) → JSON плюс до четырёх полей поиска g1…g4.
// В облаке — YDB (ydb-table.ts), в разработке — файл, в тестах — память. Логика бота работает с любой.
//   user     id = MAX id
//   booking  g1 = техника, g2 = клиент, g3 = статус
//   closed   id = техника, data = закрытые владельцем дни
//   price    id = техника, data = цена за сутки (владелец меняет сам)
//   kv, mark — по ключу

export type GField = "g1" | "g2" | "g3" | "g4";
export interface DocRow {
  kind: string;
  id: string;
  g1?: string;
  g2?: string;
  g3?: string;
  g4?: string;
  data: unknown;
}
export interface DocTx {
  get<T>(kind: string, id: string): Promise<T | undefined>;
  find<T>(kind: string, field: GField, value: string): Promise<T[]>;
  put(row: DocRow): Promise<void>;
}
export interface DocTable extends DocTx {
  del(kind: string, id: string): Promise<void>;
  dump(): Promise<DocRow[]>;
  all<T>(kind: string): Promise<T[]>;
  prefix<T>(kind: string, prefix: string): Promise<[string, T][]>;
  /** чтение и запись одним действием: никто не вклинится между проверкой и записью */
  tx<T>(fn: (t: DocTx) => Promise<T>): Promise<T>;
}

/** В памяти (тесты); с path — ещё и сохраняется в файл после каждой записи (разработка) */
export function memoryTable(path?: string): DocTable {
  const rows = new Map<string, DocRow>();
  const key = (kind: string, id: string) => `${kind}\u0000${id}`;
  if (path && existsSync(path)) for (const r of JSON.parse(readFileSync(path, "utf8")) as DocRow[]) rows.set(key(r.kind, r.id), r);
  const save = () => {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify([...rows.values()]));
    renameSync(`${path}.tmp`, path);
  };
  // Копия на входе и выходе — как у настоящей базы
  const clone = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
  let chain: Promise<unknown> = Promise.resolve();
  const t: DocTable = {
    async get<T>(kind: string, id: string) {
      return clone(rows.get(key(kind, id))?.data as T | undefined);
    },
    async find<T>(kind: string, field: GField, value: string) {
      return [...rows.values()].filter((r) => r.kind === kind && r[field] === value).map((r) => clone(r.data as T));
    },
    async put(row) {
      rows.set(key(row.kind, row.id), clone(row));
      save();
    },
    async del(kind, id) {
      rows.delete(key(kind, id));
      save();
    },
    async dump() {
      return [...rows.values()].map(clone);
    },
    async all<T>(kind: string) {
      return [...rows.values()].filter((r) => r.kind === kind).map((r) => clone(r.data as T));
    },
    async prefix<T>(kind: string, p: string) {
      return [...rows.values()]
        .filter((r) => r.kind === kind && r.id.startsWith(p))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((r) => [r.id, clone(r.data as T)] as [string, T]);
    },
    tx<T>(fn: (x: DocTx) => Promise<T>) {
      const run = chain.then(() => fn(t));
      chain = run.catch(() => {});
      return run;
    },
  };
  return t;
}
