// طبقة قاعدة البيانات — Turso (libSQL عبر HTTP) مع ضمان المخطط عند أول وصول (قسم 3)
import { createClient, type Client, type InValue } from "@libsql/client";
import { randomUUID } from "node:crypto";

let _client: Client | null = null;
let _schemaPromise: Promise<void> | null = null;

export function getTurso(): Client {
  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
  }
  return _client;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** توحيد قراءة الطوابع الزمنية (نكتب ISO دائمًا؛ الافتراضي من SQLite بلا Z) */
export function parseTs(s: string | null | undefined): number {
  if (!s) return 0;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(" ", "T") + "Z").getTime();
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** إخفاء المفتاح إلزاميًا: أول 7 + نقاط + آخر 4 (القصيرة: أول 3 + نقاط) */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length >= 14) return `${key.slice(0, 7)}••••••••${key.slice(-4)}`;
  return `${key.slice(0, 3)}••••`;
}

// ----------------------------- الأنواع -----------------------------

export interface Attempt {
  provider: string;
  keyId: string;
  keyLabel: string;
  ok: boolean;
  errorClass?: string;
  error?: string;
  at: string;
}

export interface TaskRow {
  id: string;
  provider: string;
  provider_task_id: string;
  key_id: string;
  model: string;
  type: string; // image | video | merge
  prompt: string;
  params_json: string;
  status: string; // pending | processing | completed | failed
  progress: number;
  result_urls_json: string | null;
  error_message: string | null;
  attempts_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  attempts: Attempt[];
}

export interface KeyRow {
  id: string;
  provider: string;
  label: string;
  api_key: string;
  status: string; // active | exhausted | disabled
  usage_count: number;
  success_count: number;
  fail_count: number;
  last_used_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

export type SafeKey = Omit<KeyRow, "api_key"> & { masked_key: string };

export function toSafeKey(k: KeyRow): SafeKey {
  const { api_key, ...rest } = k;
  return { ...rest, masked_key: maskKey(api_key) };
}

export function parseUrls(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : [];
  } catch {
    return [];
  }
}

// ----------------------------- المخطط -----------------------------

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  provider TEXT,
  provider_task_id TEXT,
  key_id TEXT,
  model TEXT NOT NULL,
  type TEXT NOT NULL,
  prompt TEXT DEFAULT '',
  params_json TEXT DEFAULT '{}',
  status TEXT NOT NULL,
  progress INTEGER DEFAULT 0,
  result_urls_json TEXT,
  error_message TEXT,
  attempts_json TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
)`,
  `CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT DEFAULT '',
  api_key TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  usage_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  last_used_at TEXT,
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`,
];

export async function ensureSchema(): Promise<void> {
  if (!_schemaPromise) {
    _schemaPromise = (async () => {
      for (const sql of SCHEMA_SQL) await getTurso().execute(sql);
      await seedKeyIfEmpty();
    })().catch((e) => {
      // اترك المحاولة للتكرار القادم عند فشل عابر
      _schemaPromise = null;
      throw e;
    });
  }
  return _schemaPromise;
}

export async function dbHealthy(): Promise<boolean> {
  try {
    await getTurso().execute("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/** زرع مفتاح kie.ai المزوَّد تلقائيًا فقط إذا كان جدول المفاتيح فارغًا */
async function seedKeyIfEmpty(): Promise<void> {
  const seed = process.env.SEED_KIE_API_KEY;
  if (!seed) return;
  const rs = await getTurso().execute("SELECT COUNT(*) AS c FROM api_keys");
  const count = Number((rs.rows[0] as Record<string, unknown> | undefined)?.c ?? 0);
  if (count > 0) return;
  await insertKey("kie", seed, process.env.SEED_KIE_LABEL || "");
}

// ----------------------------- المهام -----------------------------

function rowToTask(r: Record<string, unknown>): TaskRow {
  return {
    id: String(r.id ?? ""),
    provider: String(r.provider ?? ""),
    provider_task_id: String(r.provider_task_id ?? ""),
    key_id: String(r.key_id ?? ""),
    model: String(r.model ?? ""),
    type: String(r.type ?? ""),
    prompt: String(r.prompt ?? ""),
    params_json: String(r.params_json ?? "{}"),
    status: String(r.status ?? "pending"),
    progress: Number(r.progress ?? 0),
    result_urls_json: (r.result_urls_json as string | null) ?? null,
    error_message: (r.error_message as string | null) ?? null,
    attempts_json: String(r.attempts_json ?? "[]"),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
    completed_at: (r.completed_at as string | null) ?? null,
    attempts: [],
  };
}

function withAttempts(t: TaskRow): TaskRow {
  try {
    const v = JSON.parse(t.attempts_json || "[]");
    t.attempts = Array.isArray(v) ? v : [];
  } catch {
    t.attempts = [];
  }
  return t;
}

export async function insertTask(t: {
  id: string;
  provider: string;
  provider_task_id: string;
  key_id: string;
  model: string;
  type: string;
  prompt: string;
  params_json: string;
  status: string;
}): Promise<void> {
  await getTurso().execute({
    sql: `INSERT INTO tasks (id, provider, provider_task_id, key_id, model, type, prompt, params_json, status, progress, attempts_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', ?, ?)`,
    args: [t.id, t.provider, t.provider_task_id, t.key_id, t.model, t.type, t.prompt, t.params_json, t.status, nowIso(), nowIso()],
  });
}

export async function getTask(id: string): Promise<TaskRow | null> {
  const rs = await getTurso().execute({ sql: "SELECT * FROM tasks WHERE id = ?", args: [id] });
  if (!rs.rows.length) return null;
  return withAttempts(rowToTask(rs.rows[0] as Record<string, unknown>));
}

export interface TaskPatch {
  provider?: string;
  provider_task_id?: string;
  key_id?: string;
  status?: string;
  progress?: number;
  result_urls_json?: string;
  error_message?: string | null;
  params_json?: string;
  append_attempt?: Attempt;
}

/** تحديث جزئي للمهمة — يضيف المحاولات ويضبط completed_at تلقائيًا عند الاكتمال/الفشل */
export async function updateTask(id: string, patch: TaskPatch): Promise<TaskRow | null> {
  const current = await getTask(id);
  if (!current) return null;

  const attempts = [...current.attempts];
  if (patch.append_attempt) attempts.push(patch.append_attempt);

  const sets: string[] = [];
  const args: InValue[] = [];
  const set = (col: string, val: InValue) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };

  if (patch.provider !== undefined) set("provider", patch.provider);
  if (patch.provider_task_id !== undefined) set("provider_task_id", patch.provider_task_id);
  if (patch.key_id !== undefined) set("key_id", patch.key_id);
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.progress !== undefined) set("progress", Math.round(patch.progress));
  if (patch.result_urls_json !== undefined) set("result_urls_json", patch.result_urls_json);
  if (patch.error_message !== undefined) set("error_message", patch.error_message);
  if (patch.params_json !== undefined) set("params_json", patch.params_json);
  set("attempts_json", JSON.stringify(attempts));
  set("updated_at", nowIso());
  if ((patch.status === "completed" || patch.status === "failed") && !current.completed_at) {
    set("completed_at", nowIso());
  }

  await getTurso().execute({ sql: `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, args: [...args, id] });
  return getTask(id);
}

export async function listRecentTasks(
  limit: number,
  filter?: { type?: string; status?: string },
): Promise<TaskRow[]> {
  const where: string[] = [];
  const args: InValue[] = [];
  if (filter?.type) {
    where.push("type = ?");
    args.push(filter.type);
  }
  if (filter?.status) {
    where.push("status = ?");
    args.push(filter.status);
  }
  const sql = `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, updated_at DESC LIMIT ?`;
  args.push(limit);
  const rs = await getTurso().execute({ sql, args });
  return rs.rows.map((r) => withAttempts(rowToTask(r as Record<string, unknown>)));
}

export interface TaskStats {
  total: number;
  completed: number;
  failed: number;
  processing: number;
}

export async function taskStats(): Promise<TaskStats> {
  const rs = await getTurso().execute({
    sql: `SELECT COUNT(*) AS total,
                 SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
                 SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                 SUM(CASE WHEN status = 'processing' OR status = 'pending' THEN 1 ELSE 0 END) AS processing
          FROM tasks`,
  });
  const r = (rs.rows[0] ?? {}) as Record<string, unknown>;
  return {
    total: Number(r.total ?? 0),
    completed: Number(r.completed ?? 0),
    failed: Number(r.failed ?? 0),
    processing: Number(r.processing ?? 0),
  };
}

// ----------------------------- المفاتيح -----------------------------

function rowToKey(r: Record<string, unknown>): KeyRow {
  return {
    id: String(r.id ?? ""),
    provider: String(r.provider ?? ""),
    label: String(r.label ?? ""),
    api_key: String(r.api_key ?? ""),
    status: String(r.status ?? "active"),
    usage_count: Number(r.usage_count ?? 0),
    success_count: Number(r.success_count ?? 0),
    fail_count: Number(r.fail_count ?? 0),
    last_used_at: (r.last_used_at as string | null) ?? null,
    last_checked_at: (r.last_checked_at as string | null) ?? null,
    last_error: (r.last_error as string | null) ?? null,
    created_at: String(r.created_at ?? ""),
  };
}

/**
 * جلب مجمع المفاتيح بمزودات محددة — الترتيب التسلسلي الصارم بترتيب الإضافة
 * (أول مفتاح أُضيف يُجرَّب أولًا) — ليس round-robin وليس الأقل استخدامًا أولًا.
 * المستنزف (exhausted) يبقى في المجموعة ولا يُستبعد؛ الاستثناء الوحيد disabled.
 */
export async function getKeyPool(providers: string[]): Promise<KeyRow[]> {
  if (!providers.length) return [];
  const placeholders = providers.map(() => "?").join(", ");
  const rs = await getTurso().execute({
    sql: `SELECT * FROM api_keys WHERE status != 'disabled' AND provider IN (${placeholders}) ORDER BY created_at ASC, id ASC`,
    args: providers,
  });
  return rs.rows.map((r) => rowToKey(r as Record<string, unknown>));
}

export async function listKeys(): Promise<KeyRow[]> {
  const rs = await getTurso().execute({ sql: "SELECT * FROM api_keys ORDER BY created_at ASC, id ASC" });
  return rs.rows.map((r) => rowToKey(r as Record<string, unknown>));
}

export async function getKeyById(id: string): Promise<KeyRow | null> {
  const rs = await getTurso().execute({ sql: "SELECT * FROM api_keys WHERE id = ?", args: [id] });
  if (!rs.rows.length) return null;
  return rowToKey(rs.rows[0] as Record<string, unknown>);
}

export async function insertKey(provider: string, apiKey: string, label: string): Promise<KeyRow> {
  const id = randomUUID();
  await getTurso().execute({
    sql: `INSERT INTO api_keys (id, provider, label, api_key, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`,
    args: [id, provider, label || "", apiKey, nowIso()],
  });
  return (await getKeyById(id))!;
}

export async function findDuplicateKey(provider: string, apiKey: string): Promise<KeyRow | null> {
  const rs = await getTurso().execute({
    sql: "SELECT * FROM api_keys WHERE provider = ? AND api_key = ? LIMIT 1",
    args: [provider, apiKey],
  });
  if (!rs.rows.length) return null;
  return rowToKey(rs.rows[0] as Record<string, unknown>);
}

export async function patchKey(id: string, patch: { status?: string; label?: string }): Promise<KeyRow | null> {
  const sets: string[] = [];
  const args: InValue[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    args.push(patch.status);
  }
  if (patch.label !== undefined) {
    sets.push("label = ?");
    args.push(patch.label);
  }
  if (!sets.length) return getKeyById(id);
  await getTurso().execute({ sql: `UPDATE api_keys SET ${sets.join(", ")} WHERE id = ?`, args: [...args, id] });
  return getKeyById(id);
}

export async function deleteKey(id: string): Promise<boolean> {
  const rs = await getTurso().execute({ sql: "DELETE FROM api_keys WHERE id = ?", args: [id] });
  return rs.rowsAffected > 0;
}

export async function markKeyStatus(id: string, status: string, lastError?: string): Promise<void> {
  await getTurso().execute({
    sql: `UPDATE api_keys SET status = ?, last_checked_at = ?, last_error = COALESCE(?, last_error) WHERE id = ?`,
    args: [status, nowIso(), lastError ?? null, id],
  });
}

/**
 * تحديث عدّادات المفتاح — يُستدعى مع كل محاولة (نجاح أو فشل + الفئة + الخطأ المُنقَّح من الأسرار)
 */
export async function bumpKeyStats(
  id: string,
  ok: boolean,
  errorClass?: string,
  errorMessage?: string,
): Promise<void> {
  const now = nowIso();
  // عند النجاح يُمسح آخر خطأ (3 وسائط)؛ عند الفشل يُسجَّل مع الفئة (4 وسائط) — التحديث يتم مع كل محاولة
  const okSql = `UPDATE api_keys SET usage_count = usage_count + 1, success_count = success_count + 1,
       last_used_at = ?, last_checked_at = ?, last_error = NULL WHERE id = ?`;
  const failSql = `UPDATE api_keys SET usage_count = usage_count + 1, success_count = success_count,
       fail_count = fail_count + 1, last_used_at = ?, last_checked_at = ?, last_error = ? WHERE id = ?`;
  await getTurso().execute({
    sql: ok ? okSql : failSql,
    args: ok
      ? [now, now, id]
      : [now, now, errorMessage ? `[${errorClass ?? "unknown"}] ${errorMessage}`.slice(0, 500) : "[unknown] خطأ غير مصنف", id],
  });
}
