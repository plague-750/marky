// طبقة قاعدة البيانات — Turso (libSQL عبر HTTP) مع ضمان المخطط عند أول وصول (قسم 3)
import { createClient, type Client, type InValue } from "@libsql/client";
import { randomUUID } from "node:crypto";

let _client: Client | null = null;
let _schemaPromise: Promise<void> | null = null;

export function getTurso(): Client {
  if (!_client) {
    // سلسلة الاحتياط: TURSO_DATABASE_URL (سحابي) ← DATABASE_URL (ملف محلي) ← مسار افتراضي
    const url =
      process.env.TURSO_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "file:/home/z/my-project/db/custom.db";
    const authToken = process.env.TURSO_AUTH_TOKEN || undefined;
    _client = authToken ? createClient({ url, authToken }) : createClient({ url });
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
  provider: string; // اسم الـ API الحر الذي كتبه المستخدم (يُحفظ كما كُتب)
  protocol: string; // بروتوكول الاتصال: kie | cometapi — يحدد كيفية التحدث مع الـ API
  label: string; // للتوافق القديم — لم يعد يُستخدم
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

export interface ApiNameRow {
  name: string;
  protocol: string;
  updated_at: string;
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
  `CREATE TABLE IF NOT EXISTS api_names (
  name TEXT PRIMARY KEY,
  protocol TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`,
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
  protocol TEXT DEFAULT '',
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
      await migrateSchema();
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

/** ترحيلات تفاضلية — تُنفَّذ مرة واحدة عند أول وصول لكل عملية */
async function migrateSchema(): Promise<void> {
  // عمود protocol لجدول api_keys (لقواعد البيانات القديمة المنشأة قبله)
  const info = await getTurso().execute("PRAGMA table_info(api_keys)");
  const cols = info.rows.map((r) => String((r as Record<string, unknown>).name ?? ""));
  if (!cols.includes("protocol")) {
    await getTurso().execute("ALTER TABLE api_keys ADD COLUMN protocol TEXT DEFAULT ''");
  }
  // المفاتيح القديمة: بروتوكولها = مزوّدها (كانا متطابقين قبل الأسماء الحرة)
  await getTurso().execute("UPDATE api_keys SET protocol = provider WHERE protocol IS NULL OR protocol = ''");
}

/** زرع مفتاح kie.ai المزوَّد تلقائيًا فقط إذا كان جدول المفاتيح فارغًا */
async function seedKeyIfEmpty(): Promise<void> {
  const seed = process.env.SEED_KIE_API_KEY;
  if (!seed) return;
  const rs = await getTurso().execute("SELECT COUNT(*) AS c FROM api_keys");
  const count = Number((rs.rows[0] as Record<string, unknown> | undefined)?.c ?? 0);
  if (count > 0) return;
  await insertKey("kie", seed, process.env.SEED_KIE_LABEL || "", "kie");
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
    protocol: String(r.protocol ?? "") || "kie",
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
 * جلب مجمع المفاتيح بالبروتوكولات المطلوبة — الترتيب التسلسلي الصارم بترتيب الإضافة
 * (أول مفتاح أُضيف يُجرَّب أولًا) — ليس round-robin وليس الأقل استخدامًا أولًا.
 * المستنزف (exhausted) يبقى في المجموعة ولا يُستبعد؛ الاستثناء الوحيد disabled.
 * ملاحظة: المطابقة بالبروتوكول (kie/cometapi) وليس باسم الـ API الحر — فكل الأسماء
 * التي تستخدم نفس البروتوكول تشارك في نفس مجمع التجربة التسلسلية.
 */
export async function getKeyPool(protocols: string[]): Promise<KeyRow[]> {
  if (!protocols.length) return [];
  const placeholders = protocols.map(() => "?").join(", ");
  const rs = await getTurso().execute({
    sql: `SELECT * FROM api_keys WHERE status != 'disabled' AND protocol IN (${placeholders}) ORDER BY created_at ASC, id ASC`,
    args: protocols,
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

export async function insertKey(provider: string, apiKey: string, label: string, protocol: string): Promise<KeyRow> {
  const id = randomUUID();
  await getTurso().execute({
    sql: `INSERT INTO api_keys (id, provider, protocol, label, api_key, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    args: [id, provider, protocol || "kie", label || "", apiKey, nowIso()],
  });
  return (await getKeyById(id))!;
}

// ----------------------------- أسماء الـ API المحفوظة -----------------------------

/** حفظ اسم API حر — يُستدعى عند إضافة مفتاح أو تعديل الاسم؛ يظهر لاحقًا في الاقتراحات */
export async function rememberApiName(name: string, protocol: string): Promise<void> {
  await getTurso().execute({
    sql: `INSERT INTO api_names (name, protocol, created_at, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET
            updated_at = excluded.updated_at,
            protocol = CASE WHEN excluded.protocol != '' THEN excluded.protocol ELSE api_names.protocol END`,
    args: [name, protocol || "", nowIso(), nowIso()],
  });
}

export async function listApiNames(): Promise<ApiNameRow[]> {
  const rs = await getTurso().execute("SELECT name, protocol, updated_at FROM api_names ORDER BY updated_at DESC, name ASC LIMIT 50");
  return rs.rows.map((r) => ({
    name: String((r as Record<string, unknown>).name ?? ""),
    protocol: String((r as Record<string, unknown>).protocol ?? ""),
    updated_at: String((r as Record<string, unknown>).updated_at ?? ""),
  }));
}

export async function findDuplicateKey(provider: string, apiKey: string): Promise<KeyRow | null> {
  const rs = await getTurso().execute({
    sql: "SELECT * FROM api_keys WHERE provider = ? AND api_key = ? LIMIT 1",
    args: [provider, apiKey],
  });
  if (!rs.rows.length) return null;
  return rowToKey(rs.rows[0] as Record<string, unknown>);
}

export async function patchKey(
  id: string,
  patch: { status?: string; label?: string; provider?: string; protocol?: string },
): Promise<KeyRow | null> {
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
  if (patch.provider !== undefined) {
    sets.push("provider = ?");
    args.push(patch.provider);
  }
  if (patch.protocol !== undefined) {
    sets.push("protocol = ?");
    args.push(patch.protocol);
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
 * تصفير المهمة لإعادة إنتاجها يدويًا — يحذف الربط بالمزود/المفتاح والنتيجة والخطأ
 * ويضيف علامة «إعادة إنتاج يدوية» في سجل المحاولات، ثم يعيد قراءة المهمة.
 */
export async function resetTaskForRetry(id: string, marker?: Attempt): Promise<TaskRow | null> {
  const current = await getTask(id);
  if (!current) return null;
  const attempts = marker ? [...current.attempts, marker] : current.attempts;
  await getTurso().execute({
    sql: `UPDATE tasks SET provider = '', provider_task_id = '', key_id = '', status = 'processing', progress = 0,
          result_urls_json = NULL, error_message = NULL, completed_at = NULL, attempts_json = ?, updated_at = ?
          WHERE id = ?`,
    args: [JSON.stringify(attempts), nowIso(), id],
  });
  return getTask(id);
}

/** توحيد شكل المهمة في استجابات الـ API (لوحة المهام + إعادة الإنتاج) */
export function serializeTask(t: TaskRow) {
  return {
    id: t.id,
    provider: t.provider,
    model: t.model,
    type: t.type,
    prompt: t.prompt,
    status: t.status,
    progress: t.progress,
    result_urls: parseUrls(t.result_urls_json),
    error_message: t.error_message,
    attempts_count: t.attempts.length,
    attempts: t.attempts.map((a) => ({
      provider: a.provider,
      keyLabel: a.keyLabel ?? null,
      ok: a.ok,
      errorClass: a.errorClass ?? null,
      error: a.error ?? null,
      at: a.at,
    })),
    created_at: t.created_at,
    updated_at: t.updated_at,
    completed_at: t.completed_at,
  };
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
