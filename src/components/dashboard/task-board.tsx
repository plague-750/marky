"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Combine,
  ExternalLink,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
  Video,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatRelativeAr, toAbsoluteUrl, type Task, type TaskStatus, type TaskType, type TasksResponse } from "./shared";

const TYPE_META: Record<TaskType, { label: string; icon: LucideIcon; chipClass: string }> = {
  image: { label: "صورة", icon: ImageIcon, chipClass: "border-teal-500/30 bg-teal-500/10 text-teal-300" },
  video: { label: "فيديو", icon: Video, chipClass: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
  merge: { label: "دمج", icon: Combine, chipClass: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
};

const STATUS_META: Record<TaskStatus, { label: string; badgeClass: string }> = {
  completed: { label: "مكتملة", badgeClass: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
  failed: { label: "فاشلة", badgeClass: "border-rose-500/30 bg-rose-500/15 text-rose-300" },
  processing: { label: "جارية", badgeClass: "border-violet-500/30 bg-violet-500/15 text-violet-300" },
  pending: { label: "جارية", badgeClass: "border-violet-500/30 bg-violet-500/15 text-violet-300" },
};

/** مهلة اعتبار المهمة الجارية «عالقة» — بلا تحديث منذ دقيقة */
const STUCK_MS = 60_000;

interface ApiErrorBody {
  error?: string;
}

/** البطاقة (ب): لوحة المهام — إحصائيات + قائمة حية تُحدَّث كل 5 ثوانٍ + إعادة إنتاج لأي مهمة. */
export function TaskBoard({ className }: { className?: string }) {
  const { toast } = useToast();
  const [data, setData] = React.useState<TasksResponse | null>(null);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [retryBusyId, setRetryBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/tasks?limit=20", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as TasksResponse;
      setData(json);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void load(false);
    const id = setInterval(() => void load(false), 5000);
    return () => clearInterval(id);
  }, [load]);

  /** إعادة إنتاج مهمة — نفس المعطيات الأصلية وبنفس معرّف المهمة */
  const handleRetry = React.useCallback(
    async (task: Task) => {
      setRetryBusyId(task.id);
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/retry`, { method: "POST" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
          toast({
            title: "تعذّرت إعادة الإنتاج",
            description: body?.error ?? "حاول مجددًا",
            variant: "destructive",
          });
          return;
        }
        toast({
          title: "بدأت إعادة الإنتاج",
          description: "المهمة عادت للمعالجة بنفس المعطيات — تابع تقدمها هنا",
        });
        await load(false);
      } catch {
        toast({ title: "تعذّر الاتصال بالسيرفر", description: "حاول مجددًا", variant: "destructive" });
      } finally {
        setRetryBusyId(null);
      }
    },
    [load, toast],
  );

  const stats = data?.stats;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="size-5 text-teal-400" aria-hidden />
          لوحة المهام
        </CardTitle>
        <CardDescription>
          أحدث 20 مهمة مع حالتها وتقدمها — تحديث تلقائي كل 5 ثوانٍ، ويمكنك إعادة إنتاج أي مهمة فاشلة أو عالقة بضغطة.
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="icon"
            className="size-11"
            onClick={() => void load(true)}
            disabled={refreshing}
            aria-label="تحديث المهام الآن"
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* شرائح الإحصائيات */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatChip label="إجمالي" value={stats?.total} valueClass="text-foreground" />
          <StatChip label="مكتملة" value={stats?.completed} valueClass="text-emerald-400" />
          <StatChip label="فاشلة" value={stats?.failed} valueClass="text-rose-400" />
          <StatChip label="جارية" value={stats?.processing} valueClass="text-violet-300" />
        </div>

        {/* تنبيه فشل التحديث دون إسقاط البيانات المعروفة */}
        {failed && data !== null ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
            <span className="flex items-center gap-1.5">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              تعذّر آخر تحديث تلقائي — تُعرض آخر بيانات معروفة.
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-11 shrink-0 px-3 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100"
              onClick={() => void load(true)}
            >
              إعادة المحاولة
            </Button>
          </div>
        ) : null}

        {/* القائمة */}
        {initialLoading && data === null ? (
          <div className="flex flex-col gap-2" aria-hidden>
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : failed && data === null ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 py-8 text-center">
            <p className="text-sm font-medium text-rose-200">تعذّر تحميل المهام</p>
            <Button variant="outline" className="h-11" onClick={() => void load(true)}>
              <RefreshCw className="size-4" aria-hidden />
              إعادة المحاولة
            </Button>
          </div>
        ) : data !== null && data.tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <ListChecks className="size-8 text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-medium">لا توجد مهام بعد</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              ابدأ التوليد من عميل MCP (ChatGPT أو Claude أو Cursor) عبر رابط السيرفر بالأسفل وستظهر المهام هنا مباشرة
              مع حالتها وتقدمها.
            </p>
          </div>
        ) : data !== null ? (
          <div className="scrollbar-thin max-h-96 overflow-y-auto pe-1">
            <ul className="flex flex-col gap-2">
              {data.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  retryBusy={retryBusyId === task.id}
                  onRetry={() => void handleRetry(task)}
                />
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------ شريحة إحصائية ------------------------------ */

function StatChip({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: number | undefined;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2 text-center">
      {value === undefined ? (
        <Skeleton className="mx-auto h-6 w-10" />
      ) : (
        <div className={cn("text-xl font-extrabold leading-none", valueClass)}>{value}</div>
      )}
      <div className="mt-1.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/* -------------------------------- صف مهمة -------------------------------- */

function TaskRow({
  task,
  retryBusy,
  onRetry,
}: {
  task: Task;
  retryBusy: boolean;
  onRetry: () => void;
}) {
  const typeMeta = TYPE_META[task.type] ?? TYPE_META.video;
  const statusMeta = STATUS_META[task.status] ?? STATUS_META.pending;
  const isRunning = task.status === "processing" || task.status === "pending";
  const TypeIcon = typeMeta.icon;
  const progress = Math.max(0, Math.min(100, Math.round(task.progress ?? 0)));

  // مؤشر التعليق — يُحسب بعد التحميل فقط تفاديًا لاختلاف الترطيب (hydration)
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const isStuck =
    now !== null && isRunning && now - new Date(task.updated_at).getTime() > STUCK_MS;

  const confirmTitle =
    task.status === "completed"
      ? "إعادة إنتاج مهمة مكتملة؟"
      : "إعادة إنتاج مهمة جارية؟";
  const confirmBody =
    task.status === "completed"
      ? "هذه المهمة مكتملة بالفعل — إعادة الإنتاج ستبدأ محاولة جديدة بنفس الإعدادات وتستبدل الناتج الحالي."
      : "المهمة ما زالت قيد المعالجة — إعادة الإنتاج ستلغي المحاولة الحالية وتبدأ من جديد بنفس الإعدادات.";

  return (
    <li
      className={cn(
        "rounded-lg border bg-muted/20 p-3 transition-colors hover:border-teal-500/40",
        isStuck && "border-amber-500/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
            typeMeta.chipClass,
          )}
        >
          <TypeIcon className="size-3.5" aria-hidden />
          {typeMeta.label}
        </span>
        <Badge variant="outline" className={cn(statusMeta.badgeClass)}>
          {statusMeta.label}
        </Badge>
        {task.model ? (
          <code dir="ltr" className="font-mono text-[11px] text-muted-foreground">
            {task.model}
          </code>
        ) : null}
        <span className="ms-auto text-xs text-muted-foreground">{formatRelativeAr(task.created_at)}</span>
      </div>

      {task.prompt ? (
        <p dir="auto" className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {task.prompt}
        </p>
      ) : null}

      {isRunning ? (
        <Progress
          value={progress}
          aria-label={`تقدم المهمة ${progress}%`}
          className="mt-2.5 h-1.5 [&_[data-slot=progress-indicator]]:bg-violet-500"
        />
      ) : null}

      {isStuck ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-300">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          بلا تحديث منذ وقت طويل — جرّب «إعادة إنتاج» إن استمر التوقف.
        </p>
      ) : null}

      {task.status === "completed" && task.result_urls.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-start gap-2">
          {task.type === "image"
            ? task.result_urls.slice(0, 4).map((url, i) => (
                <a
                  key={`thumb-${i}`}
                  href={toAbsoluteUrl(url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                  aria-label="فتح الصورة بتبويب جديد"
                >
                  <img
                    src={toAbsoluteUrl(url)}
                    alt="نتيجة"
                    loading="lazy"
                    className="h-20 w-20 rounded-md border object-cover transition-opacity hover:opacity-80"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                </a>
              ))
            : null}
          {task.result_urls.map((url, i) => (
            <Button key={`open-${i}`} asChild variant="outline" size="sm" className="h-11">
              <a href={toAbsoluteUrl(url)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" aria-hidden />
                فتح الرابط
              </a>
            </Button>
          ))}
        </div>
      ) : null}

      {task.status === "failed" && task.error_message ? (
        <p
          dir="auto"
          className="mt-2 line-clamp-4 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 text-xs leading-relaxed text-rose-200"
        >
          {task.error_message}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span>المحاولات: {task.attempts_count ?? task.attempts.length ?? 0}</span>
        {task.attempts.length > 0 ? (
          <details className="min-w-0 flex-1">
            <summary className="cursor-pointer select-none text-xs text-muted-foreground transition-colors hover:text-foreground">
              سجل المحاولات ({task.attempts.length})
            </summary>
            <ul
              dir="ltr"
              className="scrollbar-thin mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-2 text-left font-mono text-[11px] leading-relaxed text-muted-foreground"
            >
              {task.attempts.map((attempt, i) => (
                <li key={i} className="break-words">
                  <span className={attempt.ok ? "text-emerald-400" : "text-rose-400"}>
                    {attempt.ok ? "✓" : "✗"}
                  </span>{" "}
                  <span className="text-foreground/80">{attempt.provider}</span>
                  {attempt.keyLabel ? <span> · {attempt.keyLabel}</span> : null}
                  {attempt.errorClass ? <span> · [{attempt.errorClass}]</span> : null}
                  {attempt.error ? <span> · {attempt.error}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {/* زر إعادة الإنتاج — فوري للمهام الفاشلة، وبتأكيد للجارية/المكتملة */}
        {task.status === "failed" ? (
          <Button
            variant="outline"
            size="sm"
            className="h-11 shrink-0 border-rose-500/40 text-rose-200 hover:bg-rose-500/10 hover:text-rose-100"
            disabled={retryBusy}
            onClick={onRetry}
            aria-label={`إعادة إنتاج المهمة الفاشلة ${task.id}`}
          >
            {retryBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="size-4" aria-hidden />
            )}
            إعادة إنتاج
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-11 shrink-0"
                disabled={retryBusy}
                aria-label={`إعادة إنتاج المهمة ${task.id}`}
              >
                {retryBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="size-4" aria-hidden />
                )}
                إعادة إنتاج
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
                <AlertDialogDescription>{confirmBody}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction onClick={onRetry}>نعم، أعد الإنتاج</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </li>
  );
}
