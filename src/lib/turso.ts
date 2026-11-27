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
  provider: string; // اسم الـ API الحر الذي كتبه المستخدم (يُحفظ كما كُتب) — المجموعة الفعلية للتجربة التسلسلية
  protocol: string; // بروتوكول الاتصال: kie | cometapi — يحدد كيفية التحدث مع الـ API
  capability: string; // استخدام المفتاح: both (صور وفيديو) | image (صور فقط) | video (فيديو فقط)
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

/** صف مزود — إعدادات الاتصال الفعلية قابلة للتعديل من قاعدة البيانات (قسم 3 من المواصفة) */
export interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  auth_type: string; // bearer | header | query
  auth_header: string;
  adapter_type: string; // kie | cometapi — يحدد شكل النداءات
  image_endpoint: string;
  video_endpoint: string;
  check_endpoint: string;
  enabled: number; // 1 | 0
  created_at: string;
}

/** صف خريطة موديل — canonical موحد ← اسم الموديل لدى مزود معين (قسم 4 من المواصفة) */
export interface ModelMappingRow {
  id: number;
  canonical: string;
  type: string; // image | video
  provider_id: string;
  provider_model_name: string;
  default_params_json: string | null;
  priority: number;
  enabled: number; // 1 | 0
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
  capability TEXT DEFAULT 'both',
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
  // المزودون — إعدادات الاتصال ديناميكية من قاعدة البيانات وليست Hardcoded (قسم 3)
  `CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_type TEXT DEFAULT 'bearer',
  auth_header TEXT DEFAULT 'Authorization',
  adapter_type TEXT DEFAULT 'kie',
  image_endpoint TEXT,
  video_endpoint TEXT,
  check_endpoint TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
)`,
  // خرائط الموديلات — canonical → اسم الموديل لدى كل مزود حسب الأولوية (قسم 4)
  `CREATE TABLE IF NOT EXISTS model_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical TEXT NOT NULL,
  type TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  provider_model_name TEXT NOT NULL,
  default_params_json TEXT,
  priority INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
)`,
];

export async function ensureSchema(): Promise<void> {
  if (!_schemaPromise) {
    _schemaPromise = (async () => {
      for (const sql of SCHEMA_SQL) await getTurso().execute(sql);
      await migrateSchema();
      await seedProvidersAndMappings();
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
  // عمود capability (صور فقط / فيديو فقط / صور وفيديو) لقواعد البيانات القديمة
  if (!cols.includes("capability")) {
    await getTurso().execute("ALTER TABLE api_keys ADD COLUMN capability TEXT DEFAULT 'both'");
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
  await insertKey("kie", seed, process.env.SEED_KIE_LABEL || "", "kie", "both");
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

const CAPABILITY_SET = new Set(["both", "image", "video"]);

function normalizeCapability(v: unknown): string {
  const s = String(v ?? "both").trim();
  return CAPABILITY_SET.has(s) ? s : "both";
}

function rowToKey(r: Record<string, unknown>): KeyRow {
  return {
    id: String(r.id ?? ""),
    provider: String(r.provider ?? ""),
    protocol: String(r.protocol ?? "") || "kie",
    capability: normalizeCapability(r.capability),
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
 * مجمع المفاتيح لمهمة توليد — مجمّع حسب أسماء الـ API الحرّة التي كتبها المستخدم:
 * تُجرَّب مفاتيح الاسم الأول بالترتيب (1 ثم 2 ثم 3…) وعند فشلها كلها ينتقل لمجموعة الاسم التالي،
 * وهكذا بالترتيب — الترتيب التسلسلي الصارم وليس round-robin ولا الأقل استخدامًا أولًا.
 * ترتيب المجموعات = ترتيب أول إضافة لمفتاح تحت كل اسم (يبقى ثابتًا حتى مع الحذف لاحقًا).
 * الأهلية: حسب «استخدام المفتاح» (both/image/video) + الحالة (المستنزف يبقى، المعطّل يُستبعد)
 * + البروتوكول يجب أن يكون من بروتوكولات الموديل المدعومة.
 */
export async function getKeyPoolForTask(kind: "image" | "video", protocols: string[], forceProvider?: string): Promise<KeyRow[]> {
  if (!protocols.length) return [];
  const filtered = forceProvider ? [forceProvider] : protocols;
  const protocolPlaceholders = filtered.map(() => "?").join(", ");
  const rs = await getTurso().execute({
    sql: `SELECT * FROM api_keys
          WHERE status != 'disabled'
            AND capability IN ('both', ?)
            AND protocol IN (${protocolPlaceholders})
          ORDER BY (SELECT MIN(k2.created_at) FROM api_keys k2
                    WHERE k2.provider COLLATE NOCASE = api_keys.provider COLLATE NOCASE) ASC,
                   created_at ASC, id ASC`,
    args: [kind, ...filtered],
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

export async function insertKey(
  provider: string,
  apiKey: string,
  label: string,
  protocol: string,
  capability: string = "both",
): Promise<KeyRow> {
  const id = randomUUID();
  await getTurso().execute({
    sql: `INSERT INTO api_keys (id, provider, protocol, capability, label, api_key, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    args: [id, provider, protocol || "kie", normalizeCapability(capability), label || "", apiKey, nowIso()],
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
  patch: { status?: string; label?: string; provider?: string; protocol?: string; capability?: string },
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
  if (patch.capability !== undefined) {
    sets.push("capability = ?");
    args.push(normalizeCapability(patch.capability));
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

// ----------------------------- المزودون (قسم 3 من المواصفة) -----------------------------

export const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/i;
export const ADAPTER_TYPES = new Set(["kie", "cometapi", "openrouter"]);
export const AUTH_TYPES = new Set(["bearer", "header", "query"]);

function rowToProvider(r: Record<string, unknown>): ProviderRow {
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    base_url: String(r.base_url ?? ""),
    auth_type: String(r.auth_type ?? "bearer"),
    auth_header: String(r.auth_header ?? "Authorization"),
    adapter_type: String(r.adapter_type ?? "kie"),
    image_endpoint: String(r.image_endpoint ?? ""),
    video_endpoint: String(r.video_endpoint ?? ""),
    check_endpoint: String(r.check_endpoint ?? ""),
    enabled: Number(r.enabled ?? 1) ? 1 : 0,
    created_at: String(r.created_at ?? ""),
  };
}

export async function listProviders(): Promise<ProviderRow[]> {
  const rs = await getTurso().execute("SELECT * FROM providers ORDER BY created_at ASC, id ASC");
  return rs.rows.map((r) => rowToProvider(r as Record<string, unknown>));
}

export async function getProviderById(id: string): Promise<ProviderRow | null> {
  const rs = await getTurso().execute({ sql: "SELECT * FROM providers WHERE id = ?", args: [id] });
  if (!rs.rows.length) return null;
  return rowToProvider(rs.rows[0] as Record<string, unknown>);
}

/** يزيل https:// أو http:// وشرطة النهاية لتوحيد مطابقة الروابط */
function normalizeUrlish(s: string): string {
  return s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/**
 * مطابقة صارمة للنص الحر (اسم/رابط/نوع موقع الـ API) بمزود من قاعدة البيانات — بلا Hardcoding.
 * ترتيب المطابقة: تطابق تام (المعرّف ثم الاسم ثم الرابط) ← ثم احتواء جزئي بالاتجاهين ← ثم كلمات مفتاحية معروفة.
 * تعيد null عند عدم وجود تطابق حقيقي (بدون أي fallback) — تستخدمها آلية الإنشاء التلقائي للمزودين.
 */
export function matchProviderIdFromText(text: string, providers: ProviderRow[]): string | null {
  const value = (text || "").trim().toLowerCase();
  if (!value) return null;
  const valueUrlish = normalizeUrlish(value);

  // 1) تطابق تام مع المعرّف أو الاسم أو الرابط
  for (const p of providers) {
    if (p.id.toLowerCase() === value || p.name.trim().toLowerCase() === value || normalizeUrlish(p.base_url) === valueUrlish) {
      return p.id;
    }
  }
  // 2) احتواء جزئي: النص يحوي اسم/معرّف/مضيف المزود أو العكس
  for (const p of providers) {
    const id = p.id.toLowerCase();
    const name = p.name.trim().toLowerCase();
    const host = normalizeUrlish(p.base_url);
    if (!host && !name && !id) continue;
    const hostHit = !!host && (valueUrlish.includes(host) || (valueUrlish.length >= 5 && host.includes(valueUrlish)));
    const nameHit = name.length >= 3 && value.length >= 3 && (value.includes(name) || name.includes(value));
    const idHit = id.length >= 3 && value.length >= 3 && (value.includes(id) || id.includes(value));
    if (hostHit || nameHit || idHit) return p.id;
  }
  // 3) كلمات مفتاحية شائعة في النص (comet / kie)
  if (valueUrlish.includes("comet") || value.includes("comet")) {
    const comet = providers.find((p) => p.id.toLowerCase().includes("comet") || p.name.toLowerCase().includes("comet"));
    if (comet) return comet.id;
  }
  if (valueUrlish.includes("kie") || value.includes("kie")) {
    const kie = providers.find((p) => p.id.toLowerCase().includes("kie") || p.name.toLowerCase().includes("kie"));
    if (kie) return kie.id;
  }
  return null;
}

/**
 * مطابقة النص الحر بمزود مع fallback لأول مزود مفعّل — للتوافق مع العملاء القدامى
 * (استخدم matchProviderIdFromText إن أردت صرامة المطابقة دون fallback).
 */
export function resolveProviderIdFromText(text: string, providers: ProviderRow[]): string | null {
  const matched = matchProviderIdFromText(text, providers);
  if (matched) return matched;
  return providers.find((p) => p.enabled)?.id ?? providers[0]?.id ?? null;
}

/** أنواع المحولات المدعومة — يُستخدم في تخمين نوع المحول للإنشاء التلقائي */
const KNOWN_ADAPTERS = [...ADAPTER_TYPES];

/** يولّد معرّف مزود صالحًا (حروف إنجليزية/أرقام/شرطات) من نص حر — نص عربي بالكامل → معرّف عشوائي */
function providerSlugFromText(text: string): string {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (cleaned && PROVIDER_ID_RE.test(cleaned)) return cleaned.slice(0, 40);
  return `site-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

/**
 * إنشاء مزود تلقائيًا من نص حر كتبه المستخدم (اسم أو رابط أي موقع API) — بلا أي Hardcoding:
 * - المعرّف يُشتق من النص، والاسم هو النص كما كُتب.
 * - إن كان النص رابطًا → يصبح base_url مباشرة؛ دومينًا → يُسبق بـ https؛ وإلا تخمين يُعدَّل من الواجهة.
 * - نوع المحول يُخمَّن من الكلمات المفتاحية (افتراضيًا cometapi — الشكل المتوافق مع OpenAI الأشهر).
 * - يُربط تلقائيًا بكل الموديلات الموجودة في خرائط الموديلات بأولوية أخيرة (يُجرَّب بعد المزودين الحاليين).
 * إن كان المعرّف موجودًا مسبقًا يُعاد كما هو دون إنشاء (created: false).
 */
export async function autoProvisionProviderFromText(text: string): Promise<{ id: string; created: boolean }> {
  const raw = (text || "").trim();
  if (!raw) throw new Error("نص الموقع فارغ — لا يمكن إنشاء مزود");
  const id = providerSlugFromText(raw);

  const existing = await getProviderById(id);
  if (existing) return { id: existing.id, created: false };

  // base_url: رابط كامل → الأصل (origin) | دومين → https | غير ذلك → تخمين قابل للتعديل
  let baseUrl: string;
  if (/^https?:\/\//i.test(raw)) {
    baseUrl = raw.split("/").slice(0, 3).join("/");
  } else if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(raw)) {
    baseUrl = `https://${raw}`;
  } else {
    baseUrl = `https://${id}.com`;
  }
  const adapterType = KNOWN_ADAPTERS.find((a) => id.includes(a) || raw.toLowerCase().includes(a)) ?? "cometapi";

  await insertProvider({
    id,
    name: raw.slice(0, 80),
    base_url: baseUrl,
    auth_type: "bearer",
    auth_header: "Authorization",
    adapter_type: adapterType,
    enabled: 1,
  });

  // ربط تلقائي بكل موديل موجود — أولوية أخيرة بعد كل المزودين الحاليين
  const mappings = await listModelMappings();
  const maxPriority = mappings.reduce((mx, m) => Math.max(mx, m.priority), 0);
  const seen = new Set<string>();
  for (const m of mappings) {
    const key = `${m.canonical}::${m.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await insertModelMapping({
      canonical: m.canonical,
      type: m.type,
      provider_id: id,
      provider_model_name: m.canonical,
      priority: maxPriority + 1,
      enabled: 1,
    });
  }

  return { id, created: true };
}

export interface ProviderPatch {
  name?: string;
  base_url?: string;
  auth_type?: string;
  auth_header?: string;
  adapter_type?: string;
  image_endpoint?: string;
  video_endpoint?: string;
  check_endpoint?: string;
  enabled?: number;
}

export async function insertProvider(p: {
  id: string;
  name: string;
  base_url: string;
  auth_type?: string;
  auth_header?: string;
  adapter_type?: string;
  image_endpoint?: string;
  video_endpoint?: string;
  check_endpoint?: string;
  enabled?: number;
}): Promise<ProviderRow> {
  await getTurso().execute({
    sql: `INSERT INTO providers (id, name, base_url, auth_type, auth_header, adapter_type, image_endpoint, video_endpoint, check_endpoint, enabled, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      p.id,
      p.name,
      p.base_url,
      p.auth_type || "bearer",
      p.auth_header || "Authorization",
      p.adapter_type || "kie",
      p.image_endpoint || "",
      p.video_endpoint || "",
      p.check_endpoint || "",
      p.enabled === undefined ? 1 : p.enabled ? 1 : 0,
      nowIso(),
    ],
  });
  return (await getProviderById(p.id))!;
}

export async function patchProvider(id: string, patch: ProviderPatch): Promise<ProviderRow | null> {
  const sets: string[] = [];
  const args: InValue[] = [];
  const set = (col: string, val: InValue) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.name !== undefined) set("name", patch.name);
  if (patch.base_url !== undefined) set("base_url", patch.base_url);
  if (patch.auth_type !== undefined) set("auth_type", patch.auth_type);
  if (patch.auth_header !== undefined) set("auth_header", patch.auth_header);
  if (patch.adapter_type !== undefined) set("adapter_type", patch.adapter_type);
  if (patch.image_endpoint !== undefined) set("image_endpoint", patch.image_endpoint);
  if (patch.video_endpoint !== undefined) set("video_endpoint", patch.video_endpoint);
  if (patch.check_endpoint !== undefined) set("check_endpoint", patch.check_endpoint);
  if (patch.enabled !== undefined) set("enabled", patch.enabled ? 1 : 0);
  if (!sets.length) return getProviderById(id);
  await getTurso().execute({ sql: `UPDATE providers SET ${sets.join(", ")} WHERE id = ?`, args: [...args, id] });
  return getProviderById(id);
}

/** حذف مزود — يحذف معه خرائط موديلاته ومفاتيحه المتصلة به (تعطيل الاتصال بها أثناء التوليد) */
export async function deleteProvider(id: string): Promise<boolean> {
  const rs = await getTurso().execute({ sql: "DELETE FROM providers WHERE id = ?", args: [id] });
  if (rs.rowsAffected > 0) {
    await getTurso().execute({ sql: "DELETE FROM model_mappings WHERE provider_id = ?", args: [id] });
    await getTurso().execute({ sql: "DELETE FROM api_keys WHERE protocol = ?", args: [id] });
    return true;
  }
  return false;
}

// ----------------------------- خرائط الموديلات (قسم 4 من المواصفة) -----------------------------

function rowToMapping(r: Record<string, unknown>): ModelMappingRow {
  return {
    id: Number(r.id ?? 0),
    canonical: String(r.canonical ?? ""),
    type: String(r.type ?? "image"),
    provider_id: String(r.provider_id ?? ""),
    provider_model_name: String(r.provider_model_name ?? ""),
    default_params_json: (r.default_params_json as string | null) ?? null,
    priority: Number(r.priority ?? 0),
    enabled: Number(r.enabled ?? 1) ? 1 : 0,
    created_at: String(r.created_at ?? ""),
  };
}

export async function listModelMappings(filter?: {
  canonical?: string;
  type?: string;
  provider_id?: string;
}): Promise<ModelMappingRow[]> {
  const where: string[] = [];
  const args: InValue[] = [];
  if (filter?.canonical) {
    where.push("canonical = ?");
    args.push(filter.canonical);
  }
  if (filter?.type) {
    where.push("type = ?");
    args.push(filter.type);
  }
  if (filter?.provider_id) {
    where.push("provider_id = ?");
    args.push(filter.provider_id);
  }
  const rs = await getTurso().execute({
    sql: `SELECT * FROM model_mappings ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY canonical ASC, priority ASC, id ASC`,
    args,
  });
  return rs.rows.map((r) => rowToMapping(r as Record<string, unknown>));
}

export async function getEnabledMappingsForModel(
  canonical: string,
  type: string,
): Promise<ModelMappingRow[]> {
  const rs = await getTurso().execute({
    sql: `SELECT m.* FROM model_mappings m
          JOIN providers p ON p.id = m.provider_id AND p.enabled = 1
          WHERE m.canonical = ? AND m.type = ? AND m.enabled = 1
          ORDER BY m.priority ASC, m.id ASC`,
    args: [canonical, type],
  });
  return rs.rows.map((r) => rowToMapping(r as Record<string, unknown>));
}

export async function insertModelMapping(m: {
  canonical: string;
  type: string;
  provider_id: string;
  provider_model_name: string;
  default_params_json?: string;
  priority?: number;
  enabled?: number;
}): Promise<ModelMappingRow> {
  const rs = await getTurso().execute({
    sql: `INSERT INTO model_mappings (canonical, type, provider_id, provider_model_name, default_params_json, priority, enabled, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      m.canonical,
      m.type,
      m.provider_id,
      m.provider_model_name,
      m.default_params_json || null,
      m.priority === undefined ? 0 : m.priority,
      m.enabled === undefined ? 1 : m.enabled ? 1 : 0,
      nowIso(),
    ],
  });
  const id = Number(rs.lastInsertRowid ?? 0);
  const back = await getTurso().execute({ sql: "SELECT * FROM model_mappings WHERE id = ?", args: [id] });
  return rowToMapping(back.rows[0] as Record<string, unknown>);
}

export interface ModelMappingPatch {
  canonical?: string;
  type?: string;
  provider_id?: string;
  provider_model_name?: string;
  default_params_json?: string | null;
  priority?: number;
  enabled?: number;
}

export async function patchModelMapping(id: number, patch: ModelMappingPatch): Promise<ModelMappingRow | null> {
  const sets: string[] = [];
  const args: InValue[] = [];
  const set = (col: string, val: InValue) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.canonical !== undefined) set("canonical", patch.canonical);
  if (patch.type !== undefined) set("type", patch.type);
  if (patch.provider_id !== undefined) set("provider_id", patch.provider_id);
  if (patch.provider_model_name !== undefined) set("provider_model_name", patch.provider_model_name);
  if (patch.default_params_json !== undefined) set("default_params_json", patch.default_params_json);
  if (patch.priority !== undefined) set("priority", patch.priority);
  if (patch.enabled !== undefined) set("enabled", patch.enabled ? 1 : 0);
  if (!sets.length) return getModelMappingById(id);
  await getTurso().execute({ sql: `UPDATE model_mappings SET ${sets.join(", ")} WHERE id = ?`, args: [...args, id] });
  return getModelMappingById(id);
}

export async function getModelMappingById(id: number): Promise<ModelMappingRow | null> {
  const rs = await getTurso().execute({ sql: "SELECT * FROM model_mappings WHERE id = ?", args: [id] });
  if (!rs.rows.length) return null;
  return rowToMapping(rs.rows[0] as Record<string, unknown>);
}

export async function deleteModelMapping(id: number): Promise<boolean> {
  const rs = await getTurso().execute({ sql: "DELETE FROM model_mappings WHERE id = ?", args: [id] });
  return rs.rowsAffected > 0;
}

/** زرع المزودين وخرائط الموديلات الافتراضية — مرة واحدة فقط عند أول تهيئة (ON CONFLICT لا يكرر) */
async function seedProvidersAndMappings(): Promise<void> {
  const seededProviders = [
    {
      id: "kie",
      name: "Kie.ai",
      base_url: "https://api.kie.ai",
      auth_type: "bearer",
      auth_header: "Authorization",
      adapter_type: "kie",
      image_endpoint: "/api/v1/jobs/createTask",
      video_endpoint: "/api/v1/jobs/createTask",
      check_endpoint: "/api/v1/jobs/recordInfo",
    },
    {
      id: "cometapi",
      name: "CometAPI",
      base_url: "https://api.cometapi.com",
      auth_type: "bearer",
      auth_header: "Authorization",
      adapter_type: "cometapi",
      image_endpoint: "/v1/images/generations",
      video_endpoint: "/v1/videos/generations",
      check_endpoint: "/v1/videos/{task_id}",
    },
    // NpexAPI — مزود مضاف بطلب المستخدم (بروتوكول متوافق مع OpenAI افتراضيًا).
    // base_url التقديري: تحقق منه وعدّله من «إدارة المزودين» إذا كان موقعك يستخدم رابطًا آخر.
    {
      id: "npexapi",
      name: "NpexAPI",
      base_url: "https://api.npexapi.com",
      auth_type: "bearer",
      auth_header: "Authorization",
      adapter_type: "cometapi",
      image_endpoint: "/v1/images/generations",
      video_endpoint: "/v1/videos/generations",
      check_endpoint: "/v1/videos/{task_id}",
    },
  ];
  for (const p of seededProviders) {
    await getTurso().execute({
      sql: `INSERT INTO providers (id, name, base_url, auth_type, auth_header, adapter_type, image_endpoint, video_endpoint, check_endpoint, enabled, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(id) DO NOTHING`,
      args: [p.id, p.name, p.base_url, p.auth_type, p.auth_header, p.adapter_type, p.image_endpoint, p.video_endpoint, p.check_endpoint, nowIso()],
    });
  }

  const seededMappings = [
    // gpt-image-2-6/flare-text-to-image — صور
    { canonical: "gpt-image-2-6/flare-text-to-image", type: "image", provider_id: "kie", provider_model_name: "gpt-image-2-6/flare-text-to-image", priority: 1 },
    { canonical: "gpt-image-2-6/flare-text-to-image", type: "image", provider_id: "cometapi", provider_model_name: "gpt-image-2.6-flare-text-to-image", priority: 2 },
    // grok-imagine-video-1-5-preview — فيديو
    { canonical: "grok-imagine-video-1-5-preview", type: "video", provider_id: "kie", provider_model_name: "grok-imagine-video-1-5-preview", priority: 1 },
    { canonical: "grok-imagine-video-1-5-preview", type: "video", provider_id: "cometapi", provider_model_name: "grok-imagine-video-1-5-preview", priority: 2 },
    // NpexAPI — موديلات بنفس الأسماء الافتراضية (عدّلها من إدارة الموديلات حسب أسعار/أسماء موقعك)
    { canonical: "gpt-image-2-6/flare-text-to-image", type: "image", provider_id: "npexapi", provider_model_name: "gpt-image-2-6/flare-text-to-image", priority: 3 },
    { canonical: "grok-imagine-video-1-5-preview", type: "video", provider_id: "npexapi", provider_model_name: "grok-imagine-video-1-5-preview", priority: 3 },
  ];
  for (const m of seededMappings) {
    await getTurso().execute({
      sql: `INSERT INTO model_mappings (canonical, type, provider_id, provider_model_name, default_params_json, priority, enabled, created_at)
            SELECT ?, ?, ?, ?, NULL, ?, 1, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM model_mappings WHERE canonical = ? AND type = ? AND provider_id = ?
            )`,
      args: [m.canonical, m.type, m.provider_id, m.provider_model_name, m.priority, nowIso(), m.canonical, m.type, m.provider_id],
    });
  }
}
