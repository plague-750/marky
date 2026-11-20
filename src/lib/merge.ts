// منسّق الدمج — runMerge + refreshMergeTask وفق قسم 7.3
import { randomUUID } from "node:crypto";
import {
  getTask,
  insertTask,
  updateTask,
  resetTaskForRetry,
  parseTs,
  parseUrls,
  type TaskRow,
} from "./turso";
import {
  mergerCreateJob,
  mergerGetJob,
  mergerProcess,
  mergerResultUrl,
} from "./merger";
import { absoluteMergerUrl } from "./urls";
import { RuleError } from "./errors";
import { CREATE_RETRY_COOLDOWN_MS, POLL_INTERVAL_MS, type ProgressSender } from "./generation";
import { MERGE_MODEL } from "./models";

/** قفل في الذاكرة حتى لا يُنفَّذ POST /process متزامنًا مع get_task — بمرة واحدة فقط لكل مهمة */
const processInFlight = new Set<string>();

const MSG_NEED_TWO = "❌ الدمج يحتاج مقطعَين على الأقل. مرّر urls (روابط مباشرة) أو task_ids لمهام مكتملة.";
const MSG_MAX_TEN = "❌ أقصى عدد مقاطع للدمج هو 10 (خدمة الدمج تقبل 10 مقاطع كحد أقصى).";
const MSG_NOT_FOUND = "مهمة الدمج غير موجودة في الخدمة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)";

export interface MergeOutcome {
  kind: "completed" | "processing" | "failed";
  task: TaskRow;
}

/** المضيفون المحجوزون — الروابط يجب أن تكون مباشرة وعامة */
function isPrivateHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(h)) return true;
    if (/^10\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (/^169\.254\./.test(h)) return true;
    return false;
  } catch {
    return true;
  }
}

/** حل روابط task_ids من قاعدة البيانات بالترتيب (لمهام فيديو مكتملة فقط) */
async function resolveTaskUrls(taskIds: string[]): Promise<{ urls: string[]; details: string[] }> {
  const urls: string[] = [];
  const details: string[] = [];
  for (const tid of taskIds) {
    const t = await getTask(tid.trim());
    if (!t) details.push(`- ${tid}: لا توجد مهمة بهذا المعرّف`);
    else if (t.type !== "video") details.push(`- ${tid}: نوعها ${t.type} وليست مهمة فيديو`);
    else if (t.status !== "completed") details.push(`- ${tid}: غير مكتملة بعد (الحالة: ${t.status})`);
    else {
      const ru = parseUrls(t.result_urls_json);
      if (!ru.length) details.push(`- ${tid}: مكتملة لكن بلا روابط نتيجة`);
      else urls.push(absoluteMergerUrl(ru[0]));
    }
  }
  return { urls, details };
}

/** التحقق الصارم قبل أي نداء خارجي (قسم 7.3.1) */
async function validateAndCollect(args: { urls?: string[]; task_ids?: string[] }): Promise<string[]> {
  const details: string[] = [];
  const { urls: resolved, details: taskDetails } = await resolveTaskUrls(args.task_ids || []);
  details.push(...taskDetails);

  const direct = (args.urls || []).map((u) => String(u).trim()).filter(Boolean);
  const badDirect = direct.filter((u) => !/^https?:\/\/.+/i.test(u) || isPrivateHost(u));
  if (badDirect.length) {
    details.push(
      ...badDirect.map((u) => `- ${u}: ليس رابطًا مباشرًا عامًا صالحًا (يجب أن يكون http/https عامًا)`),
    );
  }

  const all = [...resolved, ...direct.filter((u) => !badDirect.includes(u))];

  if (details.length) {
    throw new RuleError(`${MSG_NEED_TWO}\n\nتفاصيل المعرّفات/الروابط الفاشلة:\n${details.join("\n")}`);
  }
  if (all.length < 2) throw new RuleError(MSG_NEED_TWO);
  if (all.length > 10) throw new RuleError(MSG_MAX_TEN);
  return all;
}

/** إطلاق POST /process خلفيًا وبمرة واحدة فقط — محمي بقفل الذاكرة */
async function ensureProcessStarted(taskId: string): Promise<boolean> {
  if (processInFlight.has(taskId)) return false;
  const task = await getTask(taskId);
  if (!task?.provider_task_id) return false;
  processInFlight.add(taskId);
  await updateTask(taskId, { params_json: mergeParams(task, { processStarted: true }) });

  // إطلاق خلفي دون انتظار — نتيجته تُكتب في القاعدة وتظهر عبر get_task
  void (async () => {
    try {
      const r = await mergerProcess(task.provider_task_id);
      if (r.state === "done") {
        const url = mergerResultUrl(task.provider_task_id, r.videoUrl, r.downloadUrl);
        await updateTask(taskId, {
          status: "completed",
          progress: 100,
          result_urls_json: JSON.stringify([url]),
          error_message: null,
        });
      } else if (r.state === "failed") {
        // أي خطأ HTTP معلن من الخدمة = فشل نهائي فوري — لا إعادة محاولة
        await updateTask(taskId, { status: "failed", error_message: `فشل الدمج: ${r.error ?? "غير معروف"}` });
      }
      // processing → تُتابعها حلقة الاستقصاء
    } catch (e) {
      // أخطاء شبكتنا نحن = مؤقتة — تبقى المهمة processing وتستمر بالاستعلام
      console.error("merger process background error:", e instanceof Error ? e.message : e);
    } finally {
      processInFlight.delete(taskId);
    }
  })();

  return true;
}

function mergeParams(task: TaskRow, patch: Record<string, unknown>): string {
  let cur: Record<string, unknown> = {};
  try {
    cur = JSON.parse(task.params_json || "{}") as Record<string, unknown>;
  } catch {
    cur = {};
  }
  return JSON.stringify({ ...cur, ...patch });
}

/** استقصاء خدمة الدمج وتحديث المهمة في القاعدة — تعيد الحالة بعد التحديث */
async function pollMergerAndUpdate(taskId: string): Promise<{ task: TaskRow; state: "completed" | "failed" | "processing" }> {
  const task = (await getTask(taskId))!;
  if (!task.provider_task_id) return { task, state: "processing" };

  let st;
  try {
    st = await mergerGetJob(task.provider_task_id);
  } catch {
    // أخطاء شبكتنا نحن (timeout/fetch) = مؤقتة → استمر بالاستعلام حتى انتهاء النافذة
    return { task, state: "processing" };
  }

  if (st.state === "not_found") {
    const updated = await updateTask(taskId, { status: "failed", error_message: MSG_NOT_FOUND, progress: 100 });
    return { task: updated!, state: "failed" };
  }
  if (st.state === "completed") {
    const url = mergerResultUrl(task.provider_task_id, st.videoUrl, st.downloadUrl);
    const updated = await updateTask(taskId, {
      status: "completed",
      progress: 100,
      result_urls_json: JSON.stringify([url]),
      error_message: null,
    });
    return { task: updated!, state: "completed" };
  }
  if (st.state === "failed") {
    // خطأ معلن من الخدمة = فشل نهائي فوري
    const updated = await updateTask(taskId, {
      status: "failed",
      error_message: `فشل الدمج: ${st.error ?? "غير معروف"}`,
      progress: 100,
    });
    return { task: updated!, state: "failed" };
  }

  // processing / queued — حدّث التقدم (0-40 سحب المصادر، 40-90 ترميز، 100 اكتمال)
  const prog = Math.max(task.progress, Math.min(95, st.progress || (st.progress === 0 ? 10 : 30)));
  const updated = await updateTask(taskId, { status: "processing", progress: prog });
  // إن لم تبدأ الخدمة العمل بعد (تقدم 0) فتأكد من إطلاق process — استرجاع تلقائي بعد أعطال
  if (!st.progress) await ensureProcessStarted(taskId);
  return { task: updated!, state: "processing" };
}

export interface RunMergeParams {
  urls?: string[];
  task_ids?: string[];
  waitSeconds: number; // 0..240 — الافتراضي 60
  onProgress?: ProgressSender;
}

/** التدفق الكامل لأداة merge_videos (قسم 7.3) */
export async function runMerge(p: RunMergeParams): Promise<MergeOutcome> {
  // 1) تحقق صارم: ≥2 و ≤10 وكلها http/https مباشرة وعامة
  const videos = await validateAndCollect(p);

  // 2) سجّل المهمة في Turso أولًا
  const taskId = randomUUID();
  await insertTask({
    id: taskId,
    provider: "merger",
    provider_task_id: "",
    key_id: "",
    model: MERGE_MODEL.canonical,
    type: "merge",
    prompt: "",
    params_json: JSON.stringify({ videos, wait_seconds: p.waitSeconds, processStarted: false }),
    status: "pending",
  });

  // 3) أنشئ مهمة لدى الخدمة ثم أطلق process خلفيًا بمرة واحدة
  try {
    const job = await mergerCreateJob(videos);
    await updateTask(taskId, { provider_task_id: job.jobId, status: "processing", progress: 5 });
  } catch (e) {
    // فشل وصول للخدمة — تبقى processing وتُعاد المحاولة مع get_task بعد التهدئة
    const msg = e instanceof Error ? e.message : String(e);
    await updateTask(taskId, { status: "processing", error_message: `بانتظار خدمة الدمج… (${msg.slice(0, 120)})` });
    return { kind: "processing", task: (await getTask(taskId))! };
  }
  await ensureProcessStarted(taskId);

  // 4) نافذة الانتظار الافتراضية 60 ثانية: استعلم كل 3 ثوانٍ مع بث تقدم
  const deadline = Date.now() + p.waitSeconds * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (Date.now() >= deadline) break;
    const { task, state } = await pollMergerAndUpdate(taskId);
    if (state === "completed") {
      await p.onProgress?.(100, "اكتمل الدمج");
      return { kind: "completed", task };
    }
    if (state === "failed") return { kind: "failed", task };
    await p.onProgress?.(task.progress, `قيد الدمج… ${Math.round(task.progress)}%`);
  }

  return { kind: "processing", task: (await getTask(taskId))! };
}

/** get_task لمهام الدمج (refreshMergeTask — قسم 7.3.6) */
export async function refreshMergeTask(task: TaskRow): Promise<TaskRow> {
  if (task.status === "completed" || task.status === "failed") return task;

  // المهمة لم تُنشأ لدى الخدمة بعد — أعد المحاولة بعد التهدئة
  if (!task.provider_task_id) {
    const since = Date.now() - parseTs(task.updated_at);
    if (since >= CREATE_RETRY_COOLDOWN_MS) {
      const videos = (safeParams(task.params_json).videos as string[] | undefined) ?? [];
      if (videos.length >= 2) {
        try {
          const job = await mergerCreateJob(videos);
          await updateTask(task.id, { provider_task_id: job.jobId, status: "processing", progress: 5 });
          await ensureProcessStarted(task.id);
        } catch {
          // تبقى processing بانتظار توفر الخدمة
        }
      }
    }
    return (await getTask(task.id)) ?? task;
  }

  const { task: updated } = await pollMergerAndUpdate(task.id);
  return updated;
}

function safeParams(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

const RETRY_MARKER = "إعادة إنتاج يدوية";

/**
 * إعادة إنتاج مهمة دمج يدويًا من لوحة المهام:
 * تصفير كامل للمهمة ثم إنشاء مهمة دمج جديدة فورًا لدى الخدمة بنفس مقاطع المصادر
 * (الروابط تُخزَّن في params_json.videos) وإطلاق المعالجة من جديد بنفس task_id.
 */
export async function retryMergeTask(taskId: string): Promise<TaskRow | null> {
  const task = await getTask(taskId);
  if (!task || task.type !== "merge") return null;

  const videos = (safeParams(task.params_json).videos as string[] | undefined) ?? [];
  await resetTaskForRetry(taskId, {
    provider: "retry",
    keyId: "",
    keyLabel: RETRY_MARKER,
    ok: true,
    at: new Date().toISOString(),
  });

  if (videos.length < 2) {
    await updateTask(taskId, { status: "failed", error_message: MSG_NEED_TWO });
    return getTask(taskId);
  }

  // صفّر علامة بدء المعالجة حتى يُطلق POST /process من جديد للمهمة الجديدة
  const cur = safeParams((await getTask(taskId))?.params_json ?? "{}");
  await updateTask(taskId, { params_json: JSON.stringify({ ...cur, processStarted: false }) });

  try {
    const job = await mergerCreateJob(videos);
    await updateTask(taskId, { provider_task_id: job.jobId, status: "processing", progress: 5, error_message: null });
    await ensureProcessStarted(taskId);
  } catch (e) {
    // فشل وصول للخدمة — تبقى processing وتُعاد المحاولة تلقائيًا مع الاستقصاء بعد التهدئة
    const msg = e instanceof Error ? e.message : String(e);
    await updateTask(taskId, { status: "processing", error_message: `بانتظار خدمة الدمج… (${msg.slice(0, 120)})` });
  }
  return getTask(taskId);
}
