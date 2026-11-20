// منسّق التوليد — runGeneration + refreshGenerationTask مع التبديل التسلسلي للمفاتيح «لا توقف أبدًا» (قسم 4.3 و6)
import { randomUUID } from "node:crypto";
import {
  getKeyPoolForTask,
  getKeyById,
  getTask,
  insertTask,
  updateTask,
  bumpKeyStats,
  markKeyStatus,
  resetTaskForRetry,
  parseTs,
  type TaskRow,
} from "./turso";
import { resolveProvider } from "./providers";
import { ProviderError, classifyProviderError, isKeyOrBalanceFailure, scrubSecrets } from "./errors";
import { normalizeModel, IMAGE_MODEL, VIDEO_MODEL, type ModelDef } from "./models";
import type { GenInput } from "./providers/types";
import { fmtProcessing } from "./format";

/** رسالة داخلية لا تخرج للعميل أبدًا — تُخزَّن فقط في error_message أثناء انتظار مفتاح متاح */
export const INTERNAL_WAIT = "بانتظار توفر مفتاح صالح…";
/** تهدئة قبل إعادة محاولة الإنشاء مع get_task — حتى لا نضغط المزودين */
export const CREATE_RETRY_COOLDOWN_MS = 45_000;
export const POLL_INTERVAL_MS = 3_000;

export type ProgressSender = (progress: number, message: string) => Promise<void> | void;

export interface GenOutcome {
  kind: "completed" | "processing" | "failed";
  task: TaskRow;
}

interface CreateAttemptResult {
  kind: "created" | "sync_completed" | "no_key" | "params_failed";
  task?: TaskRow;
}

/**
 * محاولة إنشاء المهمة على مجمع المفاتيح بالترتيب التسلسلي الصارم:
 * أول نجاح يربط المهمة بالمزود والمفتاح؛ كل محاولة تُسجَّل في attempts_json
 * وعدّادات المفتاح تُحدَّث دائمًا. خطأ معطيات = توقف فوري.
 */
async function attemptCreation(taskId: string, model: ModelDef, input: GenInput, forceProvider?: string): Promise<CreateAttemptResult> {
  // المجمع مجمّع حسب أسماء الـ API الحرّة (المجموعة الأولى ثم التالية) ومُصفّى حسب استخدام المفتاح (صور/فيديو)
  // مزودو الموديل يأتون من جدول model_mappings حسب الأولوية — وليسوا Hardcoded. forceProvider = إجبار مزود واحد (retry_task)
  const pool = await getKeyPoolForTask(model.type === "video" ? "video" : "image", model.providers, forceProvider);

  if (!pool.length) {
    // لا مفاتيح نشطة — تبقى المهمة processing وتُعاد المحاولة تلقائيًا مع كل get_task
    await updateTask(taskId, { status: "processing", error_message: INTERNAL_WAIT });
    return { kind: "no_key" };
  }

  for (const key of pool) {
    // إعدادات المزود الحية من جدول providers + محوله حسب adapter_type — المزود معطل/محذوف → تخطّى مفاتيحه
    const resolved = await resolveProvider(key.protocol);
    const providerModel = model.providerModel[key.protocol];
    if (!resolved || !providerModel) {
      await updateTask(taskId, {
        append_attempt: { provider: key.protocol, keyId: key.id, keyLabel: key.provider, ok: false, errorClass: "provider", error: "المزود غير مفعّل أو خريطة موديله محذوفة", at: new Date().toISOString() },
      });
      continue;
    }
    const { provider, adapter } = resolved;
    try {
      // صور متزامنة (مزود يدعمها): النتيجة فورية
      if (model.type === "image" && adapter.createImageSync) {
        const { urls } = await adapter.createImageSync(key.api_key, providerModel, input, provider);
        await updateTask(taskId, {
          provider: key.protocol,
          key_id: key.id,
          status: "completed",
          progress: 100,
          result_urls_json: JSON.stringify(urls),
          append_attempt: { provider: key.protocol, keyId: key.id, keyLabel: key.provider, ok: true, at: new Date().toISOString() },
        });
        await bumpKeyStats(key.id, true);
        const task = await getTask(taskId);
        return { kind: "sync_completed", task: task! };
      }

      const { providerTaskId } = await adapter.createTask(key.api_key, providerModel, input, provider);
      await updateTask(taskId, {
        provider: key.protocol,
        provider_task_id: providerTaskId,
        key_id: key.id,
        status: "processing",
        progress: 5,
        error_message: null,
        append_attempt: { provider: key.protocol, keyId: key.id, keyLabel: key.provider, ok: true, at: new Date().toISOString() },
      });
      await bumpKeyStats(key.id, true);
      return { kind: "created" };
    } catch (e) {
      const cls = e instanceof ProviderError ? classifyProviderError(e.status, e.message) : "temporary";
      const rawMsg = e instanceof Error ? e.message : String(e);
      const safeMsg = scrubSecrets(rawMsg, [key.api_key]);
      await bumpKeyStats(key.id, false, cls, safeMsg);
      if (cls === "disabled") await markKeyStatus(key.id, "disabled", safeMsg);
      if (cls === "exhausted") await markKeyStatus(key.id, "exhausted", safeMsg);
      await updateTask(taskId, {
        append_attempt: { provider: key.protocol, keyId: key.id, keyLabel: key.provider, ok: false, errorClass: cls, error: safeMsg, at: new Date().toISOString() },
      });
      if (cls === "params") {
        // توقف فورًا — تبديل المفاتيح لن يحل خطأ معطيات
        await updateTask(taskId, { status: "failed", error_message: safeMsg });
        const task = await getTask(taskId);
        return { kind: "params_failed", task: task! };
      }
      // disabled / exhausted / provider / temporary → انتقل للمفتاح التالي دون توقف
      continue;
    }
  }

  // فشل الإنشاء على كل المفاتيح — المهمة تبقى processing (وليست failed)
  await updateTask(taskId, { status: "processing", error_message: INTERNAL_WAIT });
  return { kind: "no_key" };
}

/**
 * معالجة نتيجة فشل المهمة في منتصف الطريق:
 * إن كانت الرسالة تطابق نمط مشكلات مفتاح/رصيد → أعد إنشاء نفس المهمة بنفس task_id
 * على المفتاح التالي تلقائيًا (العميل يرى «قيد المعالجة» فقط ولا يعلم بحدوث أي تبديل).
 */
async function midTaskFailover(taskId: string, model: ModelDef, input: GenInput, failureMessage: string, failedKeyId?: string): Promise<CreateAttemptResult> {
  if (failedKeyId) {
    const key = await getKeyById(failedKeyId);
    if (key) await bumpKeyStats(key.id, false, "mid_task", scrubSecrets(failureMessage, [key.api_key]));
  }
  return attemptCreation(taskId, model, input);
}

/**
 * معالجة نتيجة checkTask المشتركة بين نافذة الانتظار و get_task.
 * تعيد الحالة النهائية للمهمة بعد التحديث من المزود (مع التبديل عند الحاجة).
 */
async function applyCheckResult(
  taskId: string,
  model: ModelDef,
  input: GenInput,
  res: { status: "processing" | "completed" | "failed"; urls?: string[]; error?: string; progress?: number },
  onProgress?: ProgressSender,
): Promise<{ outcome: "completed" | "processing" | "failed" | "retrying"; task: TaskRow }> {
  if (res.status === "completed" && res.urls?.length) {
    const task = await updateTask(taskId, {
      status: "completed",
      progress: 100,
      result_urls_json: JSON.stringify(res.urls),
      error_message: null,
    });
    await onProgress?.(100, "اكتمل التوليد");
    return { outcome: "completed", task: task! };
  }

  if (res.status === "failed") {
    const task = await getTask(taskId);
    const key = task?.key_id ? await getKeyById(task.key_id) : null;
    // فشل مفتاح/رصيد؟ → إعادة إنشاء بنفس task_id على المفتاح التالي دون إخبار العميل أبدًا
    if (isKeyOrBalanceFailure(res.error || "")) {
      const rec = await midTaskFailover(taskId, model, input, res.error || "", task?.key_id);
      if (rec.kind === "params_failed") return { outcome: "failed", task: rec.task! };
      return { outcome: "retrying", task: (await getTask(taskId))! };
    }
    // فشل حقيقي (انتهاك سياسة/معطيات) → failed
    const updated = await updateTask(taskId, { status: "failed", error_message: scrubSecrets(res.error || "فشل غير معروف", key ? [key.api_key] : []) });
    return { outcome: "failed", task: updated! };
  }

  // processing — حدّث التقدم وابث إشعارًا
  const task = await getTask(taskId);
  const prog = Math.max(task?.progress ?? 0, res.progress ?? 0);
  const updated = await updateTask(taskId, { status: "processing", progress: prog });
  await onProgress?.(prog, `قيد التوليد… ${Math.round(prog)}%`);
  return { outcome: "processing", task: updated! };
}

/** استعلام حالة المهمة من المزود بالمفتاح المربوط — مع تصنيف الأخطاء */
async function checkProviderTask(task: TaskRow): Promise<
  { ok: true; res: { status: "processing" | "completed" | "failed"; urls?: string[]; error?: string; progress?: number } }
  | { ok: false; cls: "disabled" | "exhausted" | "provider" | "params" | "temporary" }
> {
  const key = task.key_id ? await getKeyById(task.key_id) : null;
  if (!key) return { ok: false, cls: "temporary" };
  try {
    // إعدادات المزود الحية من قاعدة البيانات — المزود معطل/محذوف → فشل مزود (تبديل للمفتاح/المزود التالي)
    const resolved = await resolveProvider(task.provider);
    if (!resolved) return { ok: false, cls: "provider" };
    const { provider, adapter } = resolved;
    const res = await adapter.checkTask(key.api_key, task.provider_task_id, provider);
    return { ok: true, res };
  } catch (e) {
    const cls = e instanceof ProviderError ? classifyProviderError(e.status, e.message) : "temporary";
    const rawMsg = e instanceof Error ? e.message : String(e);
    const safeMsg = scrubSecrets(rawMsg, [key.api_key]);
    await bumpKeyStats(key.id, false, cls, safeMsg);
    if (cls === "disabled") await markKeyStatus(key.id, "disabled", safeMsg);
    if (cls === "exhausted") await markKeyStatus(key.id, "exhausted", safeMsg);
    return { ok: false, cls };
  }
}

export interface RunGenerationParams {
  type: "image" | "video";
  model: ModelDef;
  input: GenInput;
  prompt: string;
  waitSeconds: number; // 0..240
  onProgress?: ProgressSender;
}

/** التدفق الكامل لأداة generate_image / generate_video (قسم 6) */
export async function runGeneration(p: RunGenerationParams): Promise<GenOutcome> {
  const taskId = randomUUID();
  // سجّل المهمة في قاعدة البيانات قبل أي نداء خارجي — حتى لو انقطع الاتصال تبقى قابلة للتتبع
  await insertTask({
    id: taskId,
    provider: "",
    provider_task_id: "",
    key_id: "",
    model: p.model.canonical,
    type: p.type,
    prompt: p.prompt,
    params_json: JSON.stringify({ input: p.input, wait_seconds: p.waitSeconds }),
    status: "pending",
  });

  // جرّب المرشحين بالترتيب حتى نجاح الإنشاء
  const created = await attemptCreation(taskId, p.model, p.input);
  if (created.kind === "sync_completed") return { kind: "completed", task: created.task! };
  if (created.kind === "params_failed") return { kind: "failed", task: created.task! };
  if (created.kind === "no_key") {
    const task = (await getTask(taskId))!;
    return { kind: "processing", task };
  }

  // نافذة الانتظار: استعلم checkTask كل 3 ثوانٍ مع بث تقدم حي
  const deadline = Date.now() + p.waitSeconds * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (Date.now() >= deadline) break;

    const task = await getTask(taskId);
    if (!task) break;
    if (task.status === "completed" || task.status === "failed") return { kind: task.status, task };

    const checked = await checkProviderTask(task);
    if (!checked.ok) {
      if (checked.cls === "disabled" || checked.cls === "exhausted" || checked.cls === "provider") {
        // فشل مفتاح أو مزود في منتصف المهمة — أعد الإنشاء بنفس task_id على المفتاح التالي
        const rec = await midTaskFailover(taskId, p.model, p.input, `مفتاح ${checked.cls}`, task.key_id);
        if (rec.kind === "params_failed") return { kind: "failed", task: rec.task! };
        continue;
      }
      // provider / temporary → استمر بالاستعلام (المفتاح يبقى سليمًا)
      continue;
    }

    const applied = await applyCheckResult(taskId, p.model, p.input, checked.res, p.onProgress);
    if (applied.outcome === "completed") return { kind: "completed", task: applied.task };
    if (applied.outcome === "failed") return { kind: "failed", task: applied.task };
    // retrying / processing → استمر في الحلقة
  }

  // انتهت النافذة والنتيجة لم تظهر → أعد المهمة بحالة processing والعميل يتابع بـ get_task
  const task = (await getTask(taskId))!;
  if (task.status !== "completed" && task.status !== "failed") {
    const updated = await updateTask(taskId, { status: "processing" });
    return { kind: "processing", task: updated! };
  }
  return { kind: task.status as "completed" | "failed", task };
}

/** get_task لمهام التوليد: المهمة الجارية تُحدَّث حية من المزود مع نفس منطق إعادة المحاولة/التبديل */
export async function refreshGenerationTask(task: TaskRow): Promise<TaskRow> {
  if (task.status === "completed" || task.status === "failed") return task;

  const params = safeParseParams(task.params_json);
  const input: GenInput = params.input ?? { prompt: task.prompt };
  const model = resolveModel(task);

  // الإنشاء لم ينجح بعد (لا يوجد provider_task_id) — أعد المحاولة بعد تهدئة ~45 ثانية
  if (!task.provider_task_id) {
    const since = Date.now() - parseTs(task.updated_at);
    if (since >= CREATE_RETRY_COOLDOWN_MS) {
      const rec = await attemptCreation(task.id, model, input);
      if (rec.kind === "params_failed") return rec.task!;
      if (rec.kind === "sync_completed") return rec.task!;
    }
    return (await getTask(task.id)) ?? task;
  }

  const checked = await checkProviderTask(task);
  if (!checked.ok) {
    if (checked.cls === "disabled" || checked.cls === "exhausted" || checked.cls === "provider") {
      const rec = await midTaskFailover(task.id, model, input, `مفتاح ${checked.cls}`, task.key_id);
      if (rec.kind === "params_failed") return rec.task!;
    }
    return (await getTask(task.id)) ?? task;
  }

  const applied = await applyCheckResult(task.id, model, input, checked.res);
  return applied.task;
}

function safeParseParams(json: string): { input?: GenInput; wait_seconds?: number; [k: string]: unknown } {
  try {
    return JSON.parse(json || "{}") as { input?: GenInput; wait_seconds?: number; [k: string]: unknown };
  } catch {
    return {};
  }
}

/** استرجاع تعريف الموديل من اسمه المخزَّن — مع الاحتياط لنوع المهمة */
function resolveModel(task: TaskRow): ModelDef {
  return normalizeModel(task.model) ?? (task.type === "video" ? VIDEO_MODEL : IMAGE_MODEL);
}

const RETRY_MARKER = "إعادة إنتاج يدوية";

/**
 * إعادة إنتاج مهمة صورة/فيديو يدويًا من لوحة المهام أو أداة retry_task:
 * تصفير كامل للمهمة (المزود/المفتاح/النتيجة/الخطأ/التقدم) ثم محاولة إنشاء فورية
 * على مجمع المفاتيح بالترتيب التسلسلي — بنفس المعطيات الأصلية وبنفس task_id.
 * forceProvider اختياري: إجبار المحاولة على مزود محدد بمعرّفه (قسم 5 من المواصفة).
 */
export async function retryGenerationTask(taskId: string, forceProvider?: string): Promise<TaskRow | null> {
  const task = await getTask(taskId);
  if (!task || (task.type !== "image" && task.type !== "video")) return null;

  await resetTaskForRetry(taskId, {
    provider: "retry",
    keyId: "",
    keyLabel: RETRY_MARKER,
    ok: true,
    at: new Date().toISOString(),
  });

  const params = safeParseParams(task.params_json);
  const input: GenInput = params.input ?? { prompt: task.prompt };
  const model = resolveModel(task);

  // إنشاء فوري — يتخطى تهدئة 45 ثانية لأنها إعادة إنتاج مقصودة، مع إمكانية إجبار المزود
  await attemptCreation(taskId, model, input, forceProvider);
  return getTask(taskId);
}
