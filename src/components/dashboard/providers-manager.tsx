"use client";

import * as React from "react";
import {
  Globe,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  ServerCog,
  Trash2,
  TriangleAlert,
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatRelativeAr, notifyProvidersChanged, PROVIDER_LABELS, type ProviderRow, type ProvidersResponse } from "./shared";

interface ApiErrorBody {
  error?: string;
}

/** البطاقة: إدارة المزودين — جدول ديناميكي من جدول providers + نموذج إضافة مزود جديد (قسم 6).
 *  المزود هنا هو إعدادات الاتصال الحقيقية (الرابط الأساسي + نقاط النهاية + المحول) —
 *  أسماء الموديلات تُدار من «إدارة الموديلات». */
export function ProvidersManager({ className }: { className?: string }) {
  const { toast } = useToast();
  const [providers, setProviders] = React.useState<ProviderRow[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);

  // نموذج الإضافة
  const [id, setId] = React.useState("");
  const [name, setName] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [adapterType, setAdapterType] = React.useState("kie");
  const [imageEndpoint, setImageEndpoint] = React.useState("");
  const [videoEndpoint, setVideoEndpoint] = React.useState("");
  const [checkEndpoint, setCheckEndpoint] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<ProviderRow | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ProvidersResponse;
      setProviders(Array.isArray(data.providers) ? data.providers : []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedId = id.trim();
    const trimmedName = name.trim();
    const trimmedUrl = baseUrl.trim();
    if (!trimmedId) {
      toast({ title: "معرّف المزود مطلوب", description: "بالإنجليزية/الأرقام مثل: myproxy أو comet-backup", variant: "destructive" });
      return;
    }
    if (!trimmedName) {
      toast({ title: "اسم المزود مطلوب", description: "اسم للعرض فقط مثل: بروكسي خاص", variant: "destructive" });
      return;
    }
    if (!trimmedUrl) {
      toast({ title: "الرابط الأساسي مطلوب", description: "مثال: https://api.example.com", variant: "destructive" });
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: trimmedId,
          name: trimmedName,
          base_url: trimmedUrl,
          adapter_type: adapterType,
          image_endpoint: imageEndpoint.trim(),
          video_endpoint: videoEndpoint.trim(),
          check_endpoint: checkEndpoint.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({ title: "تعذّرت إضافة المزود", description: data?.error ?? "راجع البيانات وحاول مجددًا", variant: "destructive" });
        return;
      }
      toast({
        title: "تمت إضافة المزود",
        description: `«${trimmedName}» جاهز — أضف مفاتيحه من مدير المفاتيح واربط موديلاتك به من إدارة الموديلات`,
      });
      setId("");
      setName("");
      setBaseUrl("");
      setImageEndpoint("");
      setVideoEndpoint("");
      setCheckEndpoint("");
      notifyProvidersChanged();
      await load();
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (provider: ProviderRow) => {
    setBusyId(provider.id);
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(provider.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: provider.enabled ? false : true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({ title: "تعذّر تحديث الحالة", description: data?.error ?? "حاول مجددًا", variant: "destructive" });
        return;
      }
      const data = (await res.json().catch(() => null)) as { provider?: ProviderRow } | null;
      const updated = data?.provider;
      setProviders((prev) => (prev && updated ? prev.map((p) => (p.id === provider.id ? updated : p)) : prev));
      notifyProvidersChanged();
      toast({ title: updated?.enabled ? "تم تفعيل المزود" : "تم تعطيل المزود" });
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (provider: ProviderRow) => {
    setBusyId(provider.id);
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({ title: "تعذّر حذف المزود", description: data?.error ?? "حاول مجددًا", variant: "destructive" });
        return;
      }
      setProviders((prev) => (prev ? prev.filter((p) => p.id !== provider.id) : prev));
      notifyProvidersChanged();
      toast({
        title: "تم حذف المزود",
        description: "حُذفت معه خرائط موديلاته ومفاتيحه المتصلة به",
      });
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleEdited = (updated: ProviderRow) => {
    setProviders((prev) => (prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev));
    notifyProvidersChanged();
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ServerCog className="size-5 text-teal-400" aria-hidden />
          إدارة المزودين
        </CardTitle>
        <CardDescription>
          المزود هو إعدادات الاتصال الحقيقية: الرابط الأساسي ونوع المحول ونقاط النهاية — تُقرأ من قاعدة البيانات عند كل
          توليد (بلا تثبيت لأي موقع). أسماء الموديلات لكل مزود تُربط من «إدارة الموديلات».
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* نموذج الإضافة */}
        <form onSubmit={(e) => void handleAdd(e)} className="flex flex-col gap-2.5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-id" className="text-xs font-medium text-muted-foreground">
                المعرّف (ID)
              </Label>
              <Input
                id="provider-id"
                dir="ltr"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="myproxy"
                aria-label="معرّف المزود — بالإنجليزية والأرقام"
                maxLength={40}
                spellCheck={false}
                className="h-11 font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-name" className="text-xs font-medium text-muted-foreground">
                الاسم (للعرض)
              </Label>
              <Input
                id="provider-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="بروكسي خاص / CometAPI ثاني"
                aria-label="اسم المزود للعرض"
                maxLength={80}
                className="h-11"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-adapter" className="text-xs font-medium text-muted-foreground">
                نوع المحول (بروتوكول الاتصال)
              </Label>
              <Select value={adapterType} onValueChange={setAdapterType}>
                <SelectTrigger id="provider-adapter" aria-label="نوع محول المزود" className="h-11 w-full data-[size=default]:h-11">
                  <SelectValue placeholder="المحول" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kie">kie — Jobs API</SelectItem>
                  <SelectItem value="cometapi">cometapi — OpenAI-compatible</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="provider-base-url" className="text-xs font-medium text-muted-foreground">
                الرابط الأساسي (Base URL)
              </Label>
              <Input
                id="provider-base-url"
                dir="ltr"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                aria-label="الرابط الأساسي للمزود"
                spellCheck={false}
                className="h-11 font-mono text-xs"
              />
            </div>
            <Button type="submit" disabled={adding} className="h-11 w-full sm:mt-5 sm:w-auto" aria-label="إضافة مزود">
              {adding ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
              إضافة مزود
            </Button>
          </div>

          {/* نقاط النهاية — اختيارية: تُشتق من نوع المحول عند الفراغ */}
          <details className="rounded-md border bg-muted/10 px-3 py-2">
            <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
              نقاط النهاية (اختيارية — تُشتق تلقائيًا من نوع المحول عند الفراغ)
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ep-image" className="text-[11px] text-muted-foreground">
                  نقطة الصور
                </Label>
                <Input
                  id="ep-image"
                  dir="ltr"
                  value={imageEndpoint}
                  onChange={(e) => setImageEndpoint(e.target.value)}
                  placeholder="/v1/images/generations"
                  className="h-10 font-mono text-[11px]"
                  spellCheck={false}
                  aria-label="نقطة نهاية توليد الصور"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ep-video" className="text-[11px] text-muted-foreground">
                  نقطة الفيديو
                </Label>
                <Input
                  id="ep-video"
                  dir="ltr"
                  value={videoEndpoint}
                  onChange={(e) => setVideoEndpoint(e.target.value)}
                  placeholder="/v1/videos/generations"
                  className="h-10 font-mono text-[11px]"
                  spellCheck={false}
                  aria-label="نقطة نهاية توليد الفيديو"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ep-check" className="text-[11px] text-muted-foreground">
                  نقطة الاستعلام
                </Label>
                <Input
                  id="ep-check"
                  dir="ltr"
                  value={checkEndpoint}
                  onChange={(e) => setCheckEndpoint(e.target.value)}
                  placeholder="/v1/videos/{task_id}"
                  className="h-10 font-mono text-[11px]"
                  spellCheck={false}
                  aria-label="نقطة نهاية استعلام حالة المهمة"
                />
              </div>
            </div>
          </details>
        </form>

        {/* الجدول الديناميكي */}
        {providers === null && !loadFailed ? (
          <div className="flex flex-col gap-2" aria-hidden>
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : loadFailed && providers === null ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 py-8 text-center">
            <p className="text-sm font-medium text-rose-200">تعذّر تحميل المزودين</p>
            <Button variant="outline" className="h-11" onClick={() => void load()}>
              <RefreshCw className="size-4" aria-hidden />
              إعادة المحاولة
            </Button>
          </div>
        ) : providers !== null && providers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <Globe className="size-8 text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-medium">لا يوجد مزودون بعد</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              أضف مزودك الأول بالمعرّف والرابط الأساسي ونوع المحول — ثم اربط مفاتيحه وموديلاته.
            </p>
          </div>
        ) : providers !== null ? (
          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              التوليد يمرّ على مزودي الموديل المطلوب حسب أولوية خرائطه، وداخل كل مزود تُجرّب مفاتيحه بالترتيب التسلسلي.
            </p>
            <div className="scrollbar-thin max-h-[22rem] overflow-y-auto pe-1">
              <ul className="flex flex-col gap-2">
                {providers.map((p) => (
                  <ProviderItem
                    key={p.id}
                    provider={p}
                    busy={busyId === p.id}
                    onToggle={() => void handleToggle(p)}
                    onDelete={() => void handleDelete(p)}
                    onEdit={() => setEditing(p)}
                  />
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </CardContent>

      <EditProviderDialog provider={editing} onClose={() => setEditing(null)} onSaved={handleEdited} />
    </Card>
  );
}

/* -------------------------------- صف مزود -------------------------------- */

function ProviderItem({
  provider: p,
  busy,
  onToggle,
  onDelete,
  onEdit,
}: {
  provider: ProviderRow;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  return (
    <li className="rounded-lg border bg-muted/10 p-3 transition-colors hover:border-teal-500/40">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Badge
          variant="outline"
          dir="ltr"
          className="border-teal-500/30 bg-teal-500/10 font-mono text-[11px] text-teal-300"
        >
          {p.id}
        </Badge>
        <span className="text-sm font-bold">{p.name}</span>
        {PROVIDER_LABELS[p.adapter_type] ? (
          <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-300">
            محول: {PROVIDER_LABELS[p.adapter_type]}
          </Badge>
        ) : (
          <Badge variant="outline" dir="ltr" className="border-violet-500/30 bg-violet-500/10 font-mono text-[11px] text-violet-300">
            {p.adapter_type}
          </Badge>
        )}
        {p.enabled ? (
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/15 text-[11px] text-emerald-300">
            مفعّل
          </Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/15 text-[11px] text-amber-300">
            معطّل
          </Badge>
        )}

        <span className="ms-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-11 px-3" disabled={busy} onClick={onEdit} aria-label={`تعديل المزود ${p.name}`}>
            <Pencil className="size-4" aria-hidden />
            تعديل
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 px-3"
            disabled={busy}
            onClick={onToggle}
            aria-label={p.enabled ? `تعطيل المزود ${p.name}` : `تفعيل المزود ${p.name}`}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Power className="size-4" aria-hidden />}
            {p.enabled ? "تعطيل" : "تفعيل"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 px-3 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                disabled={busy}
                aria-label={`حذف المزود ${p.name}`}
              >
                <Trash2 className="size-4" aria-hidden />
                حذف
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>حذف المزود نهائيًا؟</AlertDialogTitle>
                <AlertDialogDescription>
                  سيُحذف المزود «{p.name}» (<code dir="ltr" className="font-mono">{p.id}</code>) مع خرائط موديلاته
                  ومفاتيحه المتصلة به نهائيًا، ولا يمكن التراجع.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={onDelete}>
                  نعم، احذف
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <code dir="ltr" className="max-w-full truncate font-mono text-[11px]">
          {p.base_url}
        </code>
        <span aria-hidden>•</span>
        <span dir="ltr" className="font-mono text-[10px]">
          صور: {p.image_endpoint || "(افتراضي)"} | فيديو: {p.video_endpoint || "(افتراضي)"} | استعلام:{" "}
          {p.check_endpoint || "(افتراضي)"}
        </span>
        <span aria-hidden>•</span>
        <span>أُضيف {formatRelativeAr(p.created_at)}</span>
      </div>
    </li>
  );
}

/* ----------------------------- حوار تعديل المزود ----------------------------- */

function EditProviderDialog({
  provider,
  onClose,
  onSaved,
}: {
  provider: ProviderRow | null;
  onClose: () => void;
  onSaved: (updated: ProviderRow) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [adapterType, setAdapterType] = React.useState("kie");
  const [imageEndpoint, setImageEndpoint] = React.useState("");
  const [videoEndpoint, setVideoEndpoint] = React.useState("");
  const [checkEndpoint, setCheckEndpoint] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const initializedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (provider && initializedFor.current !== provider.id) {
      setName(provider.name);
      setBaseUrl(provider.base_url);
      setAdapterType(provider.adapter_type || "kie");
      setImageEndpoint(provider.image_endpoint || "");
      setVideoEndpoint(provider.video_endpoint || "");
      setCheckEndpoint(provider.check_endpoint || "");
      initializedFor.current = provider.id;
    }
    if (!provider) initializedFor.current = null;
  }, [provider]);

  const handleSave = async () => {
    if (!provider) return;
    const trimmedUrl = baseUrl.trim();
    if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
      toast({ title: "الرابط الأساسي غير صالح", description: "يجب أن يبدأ بـ http أو https", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(provider.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          base_url: trimmedUrl,
          adapter_type: adapterType,
          image_endpoint: imageEndpoint.trim(),
          video_endpoint: videoEndpoint.trim(),
          check_endpoint: checkEndpoint.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({ title: "تعذّر حفظ التعديلات", description: data?.error ?? "حاول مجددًا", variant: "destructive" });
        return;
      }
      const data = (await res.json().catch(() => null)) as { provider?: ProviderRow } | null;
      if (data?.provider) onSaved(data.provider);
      toast({ title: "تم حفظ التعديلات", description: "الطلبات الجديدة ستستخدم الإعدادات المحدثة فورًا" });
      onClose();
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={provider !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>تعديل المزود</DialogTitle>
          <DialogDescription>
            المعرّف: <code dir="ltr" className="font-mono">{provider?.id}</code> — عدّل الرابط والمحول ونقاط النهاية.
            المعرّف نفسه لا يتغير لأن المفاتيح مرتبطة به.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-provider-name" className="text-xs font-medium text-muted-foreground">
              الاسم (للعرض)
            </Label>
            <Input id="edit-provider-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-11" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-provider-url" className="text-xs font-medium text-muted-foreground">
              الرابط الأساسي (Base URL)
            </Label>
            <Input
              id="edit-provider-url"
              dir="ltr"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="h-11 font-mono text-xs"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">نوع المحول</Label>
            <Select value={adapterType} onValueChange={setAdapterType}>
              <SelectTrigger aria-label="نوع المحول" className="h-11 w-full data-[size=default]:h-11">
                <SelectValue placeholder="المحول" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kie">kie — Jobs API</SelectItem>
                <SelectItem value="cometapi">cometapi — OpenAI-compatible</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-ep-image" className="text-[11px] text-muted-foreground">
                نقطة الصور
              </Label>
              <Input id="edit-ep-image" dir="ltr" value={imageEndpoint} onChange={(e) => setImageEndpoint(e.target.value)} className="h-10 font-mono text-[11px]" spellCheck={false} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-ep-video" className="text-[11px] text-muted-foreground">
                نقطة الفيديو
              </Label>
              <Input id="edit-ep-video" dir="ltr" value={videoEndpoint} onChange={(e) => setVideoEndpoint(e.target.value)} className="h-10 font-mono text-[11px]" spellCheck={false} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-ep-check" className="text-[11px] text-muted-foreground">
                نقطة الاستعلام
              </Label>
              <Input id="edit-ep-check" dir="ltr" value={checkEndpoint} onChange={(e) => setCheckEndpoint(e.target.value)} className="h-10 font-mono text-[11px]" spellCheck={false} />
            </div>
          </div>
          <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-amber-300/90">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            تعديل المحول لا يغيّر معرّف المزود — المفاتيح المرتبطة به ستعمل بالإعدادات الجديدة فورًا.
          </p>
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
