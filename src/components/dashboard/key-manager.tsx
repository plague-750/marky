"use client";

import * as React from "react";
import { KeyRound, Loader2, Pencil, Plus, Power, RefreshCw, Trash2 } from "lucide-react";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  formatRelativeAr,
  PROVIDER_LABELS,
  type ApiKey,
  type ApiName,
  type KeysResponse,
  type ProviderId,
} from "./shared";

const STATUS_META: Record<ApiKey["status"], { label: string; badgeClass: string }> = {
  active: { label: "نشط", badgeClass: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
  exhausted: { label: "مستنزف", badgeClass: "border-amber-500/30 bg-amber-500/15 text-amber-300" },
  disabled: { label: "معطّل", badgeClass: "border-border bg-muted text-muted-foreground" },
};

const DATALIST_ID = "api-name-suggestions";

interface ApiErrorBody {
  error?: string;
}

/** استنتاج البروتوكول من اسم الـ API — متطابق محفوظ أولًا ثم كلمات مفتاحية ثم الافتراضي */
function inferProtocol(name: string, names: ApiName[], explicit?: ProviderId): ProviderId {
  const saved = names.find((n) => n.name.toLowerCase() === name.trim().toLowerCase());
  if (saved && (saved.protocol === "kie" || saved.protocol === "cometapi")) return saved.protocol;
  if (explicit) return explicit;
  const n = name.toLowerCase();
  if (n.includes("comet")) return "cometapi";
  return "kie";
}

/** البطاقة (أ): إدارة مفاتيح المزودين — أسماء API حرة تُحفظ + تجربة تسلسلية بترتيب الإضافة. */
export function KeyManager({ className }: { className?: string }) {
  const { toast } = useToast();

  const [keys, setKeys] = React.useState<ApiKey[] | null>(null);
  const [names, setNames] = React.useState<ApiName[]>([]);
  const [loadFailed, setLoadFailed] = React.useState(false);

  const [apiName, setApiName] = React.useState("");
  const [protocol, setProtocol] = React.useState<ProviderId>("kie");
  const [apiKey, setApiKey] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [editingKey, setEditingKey] = React.useState<ApiKey | null>(null);

  const loadKeys = React.useCallback(async () => {
    try {
      const res = await fetch("/api/keys", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as KeysResponse;
      setKeys(Array.isArray(data.keys) ? data.keys : []);
      setNames(Array.isArray(data.names) ? data.names : []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  React.useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const handleNameChange = (value: string) => {
    setApiName(value);
    // مزامنة تلقائية للبروتوكول من الاسم المحفوظ أو الكلمات المفتاحية — قابل للتجاوز يدويًا
    if (value.trim()) setProtocol(inferProtocol(value, names));
  };

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = apiName.trim();
    const trimmedKey = apiKey.trim();
    if (!name) {
      toast({
        title: "اسم الـ API مطلوب",
        description: "اكتب أي اسم تحبه للـ API — سيُحفظ تلقائيًا ويظهر في الاقتراحات لاحقًا",
        variant: "destructive",
      });
      return;
    }
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
        body: JSON.stringify({ provider: name, protocol, api_key: trimmedKey }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { key?: ApiKey } | null;
        toast({
          title: "تمت إضافة المفتاح وحفظ اسم الـ API",
          description: data?.key?.masked_key
            ? `الاسم «${name}» محفوظ — المفتاح: ${data.key.masked_key}`
            : `الاسم «${name}» محفوظ — جاهز للاستخدام في التجربة التسلسلية`,
        });
        setApiKey("");
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
      toast({
        title: "تم حذف المفتاح",
        description: `اسم الـ API «${key.provider}» ما زال محفوظًا في الاقتراحات`,
      });
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const handleEdited = (updated: ApiKey) => {
    setKeys((prev) => (prev ? prev.map((k) => (k.id === updated.id ? updated : k)) : prev));
    // إعادة تحميل القائمة ليُحدَّث سجل الأسماء المحفوظة (الاقتراحات) فورًا دون إعادة تحميل للصفحة
    void loadKeys();
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5 text-violet-400" aria-hidden />
          مدير المفاتيح
        </CardTitle>
        <CardDescription>
          اكتب أي اسم تحبه للـ API — يُحفظ تلقائيًا ويظهر في الاقتراحات لاحقًا. أضف عدة مفاتيح — التجربة تسلسلية بترتيب
          الإضافة (أول مفتاح ثم التالي…) مع تبديل فوري تلقائي عند أي خطأ أو نفاد رصيد دون توقف.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* نموذج الإضافة */}
        <form onSubmit={(e) => void handleAdd(e)} className="flex flex-col gap-2.5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="api-name-input" className="text-xs font-medium text-muted-foreground">
                اسم الـ API (حر — يُحفظ)
              </label>
              <Input
                id="api-name-input"
                value={apiName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="مثال: حسابي الأساسي، CometAPI ثاني…"
                aria-label="اسم الـ API — نص حر يُحفظ تلقائيًا"
                list={DATALIST_ID}
                maxLength={60}
                className="h-11"
              />
              <datalist id={DATALIST_ID}>
                {names.map((n) => (
                  <option key={n.name} value={n.name} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">بروتوكول الاتصال</label>
              <Select value={protocol} onValueChange={(v) => setProtocol(v as ProviderId)}>
                <SelectTrigger aria-label="بروتوكول الاتصال" className="h-11 w-full data-[size=default]:h-11">
                  <SelectValue placeholder="البروتوكول" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kie">kie.ai</SelectItem>
                  <SelectItem value="cometapi">CometAPI</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
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
          </div>
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
              اكتب اسم الـ API وأضف أول مفتاح من النموذج أعلاه — يمكنك إضافة عدة مفاتيح بنفس الاسم أو بأسماء مختلفة
              وسيتبدل السيرفر بينها تلقائيًا بالترتيب.
            </p>
          </div>
        ) : keys !== null ? (
          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              الترتيب التسلسلي للتجربة: المفتاح رقم 1 يُجرَّب أولًا ثم ما يليه تلقائيًا عند أي فشل.
            </p>
            <div className="scrollbar-thin max-h-96 overflow-y-auto pe-1">
              <ol className="flex flex-col gap-2">
                {keys.map((key, index) => (
                  <KeyRow
                    key={key.id}
                    apiKey={key}
                    order={index + 1}
                    busy={busyId === key.id}
                    deleteBusy={deletingId === key.id}
                    onToggle={() => void handleToggle(key)}
                    onDelete={() => void handleDelete(key)}
                    onEdit={() => setEditingKey(key)}
                  />
                ))}
              </ol>
            </div>
          </div>
        ) : null}
      </CardContent>

      {/* حوار تعديل الاسم/البروتوكول */}
      <EditKeyDialog
        apiKey={editingKey}
        onClose={() => setEditingKey(null)}
        onSaved={handleEdited}
      />
    </Card>
  );
}

/* ------------------------------- صف مفتاح ------------------------------- */

function KeyRow({
  apiKey: key,
  order,
  busy,
  deleteBusy,
  onToggle,
  onDelete,
  onEdit,
}: {
  apiKey: ApiKey;
  order: number;
  busy: boolean;
  deleteBusy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const protocolLabel = PROVIDER_LABELS[key.protocol] ?? key.protocol;
  const statusMeta = STATUS_META[key.status] ?? STATUS_META.disabled;

  return (
    <li className="rounded-lg border bg-muted/20 p-3 transition-colors hover:border-violet-500/40">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span
          aria-label={`الترتيب التسلسلي ${order}`}
          title="ترتيب التجربة التسلسلية"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-violet-500/40 bg-violet-500/10 font-mono text-[11px] font-bold text-violet-300"
        >
          {order}
        </span>
        <span className="text-sm font-semibold">{key.provider?.trim() || "بدون اسم"}</span>
        <code dir="ltr" className="font-mono text-[11px] text-muted-foreground">
          {key.masked_key}
        </code>
        <Badge variant="outline" dir="ltr" className="border-teal-500/30 bg-teal-500/10 font-mono text-[11px] text-teal-300">
          {protocolLabel}
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
            onClick={onEdit}
            aria-label={`تعديل اسم الـ API أو البروتوكول للمفتاح ${key.masked_key}`}
          >
            <Pencil className="size-4" aria-hidden />
            تعديل
          </Button>
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
                  سيُحذف المفتاح (<code dir="ltr" className="font-mono">{key.masked_key}</code>) من اسم الـ API «
                  {key.provider}» نهائيًا، ولا يمكن التراجع عن هذا الإجراء. اسم الـ API نفسه سيبقى محفوظًا في
                  الاقتراحات.
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

/* --------------------------- حوار التعديل --------------------------- */

function EditKeyDialog({
  apiKey: key,
  onClose,
  onSaved,
}: {
  apiKey: ApiKey | null;
  onClose: () => void;
  onSaved: (updated: ApiKey) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [protocol, setProtocol] = React.useState<ProviderId>("kie");
  const [saving, setSaving] = React.useState(false);
  const initializedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (key && initializedFor.current !== key.id) {
      setName(key.provider ?? "");
      setProtocol(key.protocol === "cometapi" ? "cometapi" : "kie");
      initializedFor.current = key.id;
    }
    if (!key) initializedFor.current = null;
  }, [key]);

  const handleSave = async () => {
    if (!key) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "اسم الـ API مطلوب", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(key.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: trimmed, protocol }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({ title: "تعذّر حفظ التعديلات", description: data?.error ?? "حاول مجددًا", variant: "destructive" });
        return;
      }
      const data = (await res.json().catch(() => null)) as { key?: ApiKey } | null;
      if (data?.key) onSaved(data.key);
      toast({
        title: "تم حفظ التعديلات",
        description: `الاسم «${trimmed}» محفوظ الآن في الاقتراحات أيضًا`,
      });
      onClose();
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={key !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل اسم الـ API والبروتوكول</DialogTitle>
          <DialogDescription>
            المفتاح: <code dir="ltr" className="font-mono">{key?.masked_key}</code> — غيّر الاسم أو البروتوكول وسيُحفظ
            الاسم الجديد تلقائيًا.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-api-name" className="text-xs font-medium text-muted-foreground">
              اسم الـ API
            </label>
            <Input
              id="edit-api-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="h-11"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">بروتوكول الاتصال</label>
            <Select value={protocol} onValueChange={(v) => setProtocol(v as ProviderId)}>
              <SelectTrigger aria-label="بروتوكول الاتصال" className="h-11 w-full data-[size=default]:h-11">
                <SelectValue placeholder="البروتوكول" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kie">kie.ai</SelectItem>
                <SelectItem value="cometapi">CometAPI</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
