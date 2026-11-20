// طبقة التجريد للوصول للبيانات — DataAdapter (قسم 3 من المواصفة)
// الافتراضي: Turso عبر @libsql/client (محليًا file: أو سحابيًا عبر TURSO_DATABASE_URL).
// لإضافة مزود تخزين جديد (Postgres / Firebase لاحقًا) نفّذ نفس واجهة DataAdapter
// ثم بدّل كائن db بالأسفل — بقية الكود لا يتغير.
import {
  // أنواع الصفوف
  type Attempt,
  type KeyRow,
  type ModelMappingRow,
  type ProviderRow,
  type TaskRow,
  type TaskStats,
  // مهام
  deleteModelMapping,
  getModelMappingById,
  getTask,
  insertTask,
  listModelMappings,
  listRecentTasks,
  patchModelMapping,
  resetTaskForRetry,
  taskStats,
  updateTask,
  // مفاتيح
  bumpKeyStats,
  deleteKey,
  getKeyById,
  insertKey,
  listKeys,
  markKeyStatus,
  patchKey,
  // مزودون
  deleteProvider,
  getProviderById,
  insertProvider,
  listProviders,
  patchProvider,
  // خرائط موديلات
  getEnabledMappingsForModel,
  insertModelMapping,
} from "../turso";

export {
  // إعادة تصدير الأنواع والأدوات المساعدة لاستهلاك الواجهات دون الربط المباشر بطبقة Turso
  type Attempt,
  type KeyRow,
  type ModelMappingRow,
  type ProviderRow,
  type SafeKey,
  type TaskRow,
  type TaskStats,
  dbHealthy,
  maskKey,
  nowIso,
  parseTs,
  serializeTask,
  toSafeKey,
} from "../turso";

import { dbHealthy, maskKey, serializeTask, toSafeKey } from "../turso";
import type { TaskPatch } from "../turso";

/** عقد الواجهة الموحدة لأي مزود تخزين (Turso افتراضيًا — قابلة للتوسع لـ Postgres/Firebase) */
export interface DataAdapter {
  // مهام التوليد
  getTask(id: string): Promise<TaskRow | null>;
  insertTask(t: {
    id: string;
    provider: string;
    provider_task_id: string;
    key_id: string;
    model: string;
    type: string;
    prompt: string;
    params_json: string;
    status: string;
  }): Promise<void>;
  updateTask(id: string, patch: TaskPatch): Promise<TaskRow | null>;
  listRecentTasks(limit: number, filter?: { type?: string; status?: string }): Promise<TaskRow[]>;
  taskStats(): Promise<TaskStats>;
  resetTaskForRetry(id: string, marker?: Attempt): Promise<TaskRow | null>;

  // المفاتيح
  listKeys(): Promise<KeyRow[]>;
  getKeyById(id: string): Promise<KeyRow | null>;
  insertKey(provider: string, apiKey: string, label: string, protocol: string, capability?: string): Promise<KeyRow>;
  patchKey(
    id: string,
    patch: { status?: string; label?: string; provider?: string; protocol?: string; capability?: string },
  ): Promise<KeyRow | null>;
  deleteKey(id: string): Promise<boolean>;
  bumpKeyStats(id: string, ok: boolean, errorClass?: string, errorMessage?: string): Promise<void>;
  markKeyStatus(id: string, status: string, lastError?: string): Promise<void>;
  maskKey(key: string): string;

  // المزودون
  listProviders(): Promise<ProviderRow[]>;
  getProviderById(id: string): Promise<ProviderRow | null>;
  insertProvider(p: Parameters<typeof insertProvider>[0]): Promise<ProviderRow>;
  patchProvider(id: string, patch: Parameters<typeof patchProvider>[1]): Promise<ProviderRow | null>;
  deleteProvider(id: string): Promise<boolean>;

  // خرائط الموديلات
  listModelMappings(filter?: { canonical?: string; type?: string; provider_id?: string }): Promise<ModelMappingRow[]>;
  getEnabledMappingsForModel(canonical: string, type: string): Promise<ModelMappingRow[]>;
  insertModelMapping(m: Parameters<typeof insertModelMapping>[0]): Promise<ModelMappingRow>;
  patchModelMapping(id: number, patch: Parameters<typeof patchModelMapping>[1]): Promise<ModelMappingRow | null>;
  getModelMappingById(id: number): Promise<ModelMappingRow | null>;
  deleteModelMapping(id: number): Promise<boolean>;

  // جهوزية + أدوات
  dbHealthy(): Promise<boolean>;
  serializeTask(t: TaskRow): ReturnType<typeof serializeTask>;
  toSafeKey(k: KeyRow): ReturnType<typeof toSafeKey>;
}

/** محوّل Turso — التنفيذ الافتراضي لواجهة DataAdapter (يفوّض للدوال في ../turso) */
class TursoAdapter implements DataAdapter {
  getTask = getTask;
  insertTask = insertTask;
  updateTask = updateTask;
  listRecentTasks = listRecentTasks;
  taskStats = taskStats;
  resetTaskForRetry = resetTaskForRetry;

  listKeys = listKeys;
  getKeyById = getKeyById;
  insertKey = insertKey;
  patchKey = patchKey;
  deleteKey = deleteKey;
  bumpKeyStats = bumpKeyStats;
  markKeyStatus = markKeyStatus;
  maskKey = maskKey;

  listProviders = listProviders;
  getProviderById = getProviderById;
  insertProvider = insertProvider;
  patchProvider = patchProvider;
  deleteProvider = deleteProvider;

  listModelMappings = listModelMappings;
  getEnabledMappingsForModel = getEnabledMappingsForModel;
  insertModelMapping = insertModelMapping;
  patchModelMapping = patchModelMapping;
  getModelMappingById = getModelMappingById;
  deleteModelMapping = deleteModelMapping;

  dbHealthy = dbHealthy;
  serializeTask = serializeTask;
  toSafeKey = toSafeKey;
}

/** الكائن الوحيد للوصول للبيانات — بدّله لتبديل مزود التخزين بالكامل */
export const db: DataAdapter = new TursoAdapter();
