"use client";

import * as React from "react";
import { KeyRound, Loader2, Plus, Power, RefreshCw, Trash2 } from "lucide-react";

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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatRelativeAr, PROVIDER_LABELS, type ApiKey, type ProviderId } from "./shared";

const STATUS_META: Record<ApiKey["status"], { label: string; badgeClass: string }> = {
  active: { label: "نشط", badgeClass: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
  exhausted: { label: "مستنزف", badgeClass: "border-amber-500/30 bg-amber-500/15 text-amber-300" },
  disabled: { label: "معطّل", badgeClass: "border-border bg-muted text-muted-foreground" },
};

interface ApiErrorBody {
  error?: string;
}

/** البطاقة (أ): إدارة مفاتيح المزودين — إضافة/تعطيل/حذف مع عرض الحالة والعدادات. */
export function KeyManager({ className }: { className?: string }) {
  const { toast } = useToast();

  const [keys, setKeys] = React.useState<ApiKey[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);

  const [provider, setProvider] = React.useState<ProviderId>("kie");
  const [label, setLabel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const loadKeys = React.useCallback(async () => {
    try {
      const res = await fetch("/api/keys", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { keys?: ApiKey[] };
      setKeys(Array.isArray(data.keys) ? data.keys : []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  React.useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      toast({
        title: "المفتاح مطلوب",
        description: "ألصق مفتاح API في الحقل المخصص أولًا",
        variant: "destructive",
      });
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          api_key: trimmedKey,
          ...(label.trim() ? { label: label.trim() } : {}),
        }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { key?: ApiKey } | null;
        toast({
          title: "تمت إضافة المفتاح بنجاح",
          description: data?.key?.masked_key ? `المفتاح: ${data.key.masked_key}` : "جاهز للاستخدام في التجربة التسلسلية",
        });
        setApiKey("");
        setLabel("");
        await loadKeys();
      } else {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({
          title: "تعذّرت إضافة المفتاح",
          description: data?.error ?? "راجع البيانات وحاول مجددًا",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", description: "تحقق من الشبكة وحاول مجددًا", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (key: ApiKey) => {
    const nextStatus: ApiKey["status"] = key.status === "active" ? "disabled" : "active";
    setBusyId(key.id);
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(key.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({ title: "تعذّر تحديث الحالة", description: data?.error ?? "حاول مجددًا", variant: "destructive" });
        return;
      }
      const data = (await res.json().catch(() => null)) as { key?: ApiKey } | null;
      const updated = data?.key;
      setKeys((prev) => (prev && updated ? prev.map((k) => (k.id === key.id ? updated : k)) : prev));
      toast({ title: nextStatus === "active" ? "تم تنشيط المفتاح" : "تم تعطيل المفتاح" });
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (key: ApiKey) => {
    setDeletingId(key.id);
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({ title: "تعذّر حذف المفتاح", description: data?.error ?? "حاول مجددًا", variant: "destructive" });
        return;
      }
      setKeys((prev) => (prev ? prev.filter((k) => k.id !== key.id) : prev));
      toast({ title: "تم حذف المفتاح" });
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5 text-violet-400" aria-hidden />
          مدير المفاتيح
        </CardTitle>
        <CardDescription>
          أضف عدة مفاتيح لكل مزود — التجربة تسلسلية (أول مفتاح ثم التالي ثم التالي) مع تبديل فوري تلقائي عند أي خطأ أو
          نفاد رصيد دون توقف.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* نموذج الإضافة */}
        <form onSubmit={(e) => void handleAdd(e)} className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <Select value={provider} onValueChange={(v) => setProvider(v as ProviderId)}>
            <SelectTrigger
              aria-label="اختيار المزود"
              className="h-11 w-full data-[size=default]:h-11 sm:w-40"
            >
              <SelectValue placeholder="المزود" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="kie">kie.ai</SelectItem>
              <SelectItem value="cometapi">CometAPI</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="تسمية اختيارية"
            aria-label="تسمية اختيارية للمفتاح"
            className="h-11 w-full sm:w-44"
            maxLength={80}
          />
          <Input
            dir="ltr"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="ألصق مفتاح API هنا"
            aria-label="مفتاح API"
            autoComplete="off"
            spellCheck={false}
            className="h-11 flex-1 font-mono text-xs"
          />
          <Button type="submit" disabled={adding} className="h-11 w-full sm:w-auto" aria-label="إضافة مفتاح">
            {adding ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            إضافة مفتاح
          </Button>
        </form>

        {/* القائمة */}
        {keys === null && !loadFailed ? (
          <div className="flex flex-col gap-2" aria-hidden>
            <Skeleton className="h-[76px] w-full rounded-lg" />
            <Skeleton className="h-[76px] w-full rounded-lg" />
            <Skeleton className="h-[76px] w-full rounded-lg" />
          </div>
        ) : loadFailed && keys === null ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 py-8 text-center">
            <p className="text-sm font-medium text-rose-200">تعذّر تحميل قائمة المفاتيح</p>
            <Button variant="outline" className="h-11" onClick={() => void loadKeys()}>
              <RefreshCw className="size-4" aria-hidden />
              إعادة المحاولة
            </Button>
          </div>
        ) : keys !== null && keys.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <KeyRound className="size-8 text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-medium">لا توجد مفاتيح بعد</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              أضف أول مفتاح من النموذج أعلاه لبدء الاستخدام — يمكنك إضافة عدة مفاتيح لكل مزود وسيتبدل السيرفر بينها
              تلقائيًا.
            </p>
          </div>
        ) : keys !== null ? (
          <div className="scrollbar-thin max-h-96 overflow-y-auto pe-1">
            <ul className="flex flex-col gap-2">
              {keys.map((key) => (
                <KeyRow
                  key={key.id}
                  apiKey={key}
                  busy={busyId === key.id}
                  deleteBusy={deletingId === key.id}
                  onToggle={() => void handleToggle(key)}
                  onDelete={() => void handleDelete(key)}
                />
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------- صف مفتاح ------------------------------- */

function KeyRow({
  apiKey: key,
  busy,
  deleteBusy,
  onToggle,
  onDelete,
}: {
  apiKey: ApiKey;
  busy: boolean;
  deleteBusy: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const providerLabel = PROVIDER_LABELS[key.provider] ?? key.provider;
  const statusMeta = STATUS_META[key.status] ?? STATUS_META.disabled;

  return (
    <li className="rounded-lg border bg-muted/20 p-3 transition-colors hover:border-violet-500/40">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-sm font-semibold">{key.label?.trim() ? key.label.trim() : providerLabel}</span>
        <code dir="ltr" className="font-mono text-[11px] text-muted-foreground">
          {key.masked_key}
        </code>
        <Badge variant="outline" dir="ltr" className="border-teal-500/30 bg-teal-500/10 font-mono text-[11px] text-teal-300">
          {providerLabel}
        </Badge>
        <Badge variant="outline" className={cn(statusMeta.badgeClass)}>
          {statusMeta.label}
        </Badge>

        <span className="ms-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-11 px-3"
            disabled={busy || deleteBusy}
            onClick={onToggle}
            aria-label={key.status === "active" ? `تعطيل المفتاح ${key.masked_key}` : `تنشيط المفتاح ${key.masked_key}`}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Power className="size-4" aria-hidden />
            )}
            {key.status === "active" ? "تعطيل" : "تنشيط"}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 px-3 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                disabled={busy || deleteBusy}
                aria-label={`حذف المفتاح ${key.masked_key}`}
              >
                <Trash2 className="size-4" aria-hidden />
                حذف
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>حذف المفتاح نهائيًا؟</AlertDialogTitle>
                <AlertDialogDescription>
                  سيُحذف مفتاح {providerLabel}{" "}
                  (<code dir="ltr" className="font-mono">{key.masked_key}</code>) نهائيًا من القائمة، ولا يمكن التراجع
                  عن هذا الإجراء.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={onDelete}
                >
                  نعم، احذف
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          استخدام: {key.usage_count ?? 0} | نجاح: {key.success_count ?? 0} | فشل: {key.fail_count ?? 0}
        </span>
        <span aria-hidden>•</span>
        <span>أُضيف {formatRelativeAr(key.created_at)}</span>
      </div>

      {key.last_error ? (
        <p dir="auto" className="mt-1.5 line-clamp-2 text-xs text-muted-foreground/80">
          آخر خطأ: {key.last_error}
        </p>
      ) : null}
    </li>
  );
}
