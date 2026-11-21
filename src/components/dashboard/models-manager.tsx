"use client";

import * as React from "react";
import {
  Boxes,
  Image as ImageIcon,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Trash2,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { PROVIDER_LABELS, PROVIDERS_CHANGED_EVENT, type ModelMapping, type ModelsResponse, type ProviderRow, type ProvidersResponse } from "./shared";

interface ApiErrorBody {
  error?: string;
}

const TYPE_META: Record<ModelMapping["type"], { label: string; chipClass: string; icon: typeof ImageIcon }> = {
  image: { label: "صورة", chipClass: "border-teal-500/30 bg-teal-500/10 text-teal-300", icon: ImageIcon },
  video: { label: "فيديو", chipClass: "border-violet-500/30 bg-violet-500/10 text-violet-300", icon: Video },
};

/** البطاقة: إدارة الموديلات — خرائط الاسم الموحد (canonical) ← اسم الموديل لدى كل مزود حسب الأولوية (قسم 6).
 *  عند طلب توليد بموديل معين يقرأ السيرفر خرائطه المفعّلة بالترتيب ويجرّب مفاتيح كل مزود بالترتيب التسلسلي. */
export function ModelsManager({ className }: { className?: string }) {
  const { toast } = useToast();
  const [mappings, setMappings] = React.useState<ModelMapping[] | null>(null);
  const [providers, setProviders] = React.useState<ProviderRow[]>([]);
  const [loadFailed, setLoadFailed] = React.useState(false);

  const [canonical, setCanonical] = React.useState("");
  const [type, setType] = React.useState<"image" | "video">("image");
  const [providerId, setProviderId] = React.useState("");
  const [providerModelName, setProviderModelName] = React.useState("");
  const [priority, setPriority] = React.useState("1");
  const [adding, setAdding] = React.useState(false);
  const [busyId, setBusyId] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [mRes, pRes] = await Promise.all([
        fetch("/api/models", { cache: "no-store" }),
        fetch("/api/providers", { cache: "no-store" }),
      ]);
      if (!mRes.ok) throw new Error(String(mRes.status));
      const mData = (await mRes.json()) as ModelsResponse;
      setMappings(Array.isArray(mData.mappings) ? mData.mappings : []);
      if (pRes.ok) {
        const pData = (await pRes.json()) as ProvidersResponse;
        setProviders(Array.isArray(pData.providers) ? pData.providers : []);
      }
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // تحديث فوري لقائمة المزودين عند أي تغيير من «إدارة المزودين» (إضافة/تعطيل/حذف/تعديل)
  React.useEffect(() => {
    const handler = () => void load();
    window.addEventListener(PROVIDERS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(PROVIDERS_CHANGED_EVENT, handler);
  }, [load]);

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCanonical = canonical.trim();
    const trimmedName = providerModelName.trim();
    const trimmedProvider = providerId.trim();
    if (!trimmedCanonical) {
      toast({ title: "الاسم الموحد مطلوب", description: "مثال: gpt-image-2-6/flare-text-to-image", variant: "destructive" });
      return;
    }
    if (!trimmedProvider) {
      toast({ title: "المزود مطلوب", description: "اختر مزودًا من القائمة — أضف مزودًا جديدًا من إدارة المزودين", variant: "destructive" });
      return;
    }
    if (!trimmedName) {
      toast({ title: "اسم الموديل لدى المزود مطلوب", description: "الاسم الذي يفهمه المزود نفسه", variant: "destructive" });
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonical: trimmedCanonical,
          type,
          provider_id: trimmedProvider,
          provider_model_name: trimmedName,
          priority: Number(priority) || 0,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({ title: "تعذّرت إضافة الخريطة", description: data?.error ?? "راجع البيانات وحاول مجددًا", variant: "destructive" });
        return;
      }
      toast({
        title: "تمت إضافة خريطة الموديل",
        description: `«${trimmedCanonical}» → ${trimmedName} عبر ${PROVIDER_LABELS[trimmedProvider] ?? trimmedProvider}`,
      });
      setProviderModelName("");
      await load();
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (mapping: ModelMapping) => {
    setBusyId(mapping.id);
    try {
      const res = await fetch(`/api/models/${mapping.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: mapping.enabled ? false : true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({ title: "تعذّر تحديث الحالة", description: data?.error ?? "حاول مجددًا", variant: "destructive" });
        return;
      }
      const data = (await res.json().catch(() => null)) as { mapping?: ModelMapping } | null;
      const updated = data?.mapping;
      setMappings((prev) => (prev && updated ? prev.map((m) => (m.id === mapping.id ? updated : m)) : prev));
      toast({ title: updated?.enabled ? "تم تفعيل الخريطة" : "تم تعطيل الخريطة" });
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (mapping: ModelMapping) => {
    setBusyId(mapping.id);
    try {
      const res = await fetch(`/api/models/${mapping.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({ title: "تعذّر حذف الخريطة", description: data?.error ?? "حاول مجددًا", variant: "destructive" });
        return;
      }
      setMappings((prev) => (prev ? prev.filter((m) => m.id !== mapping.id) : prev));
      toast({ title: "تم حذف الخريطة" });
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  // تجميع حسب الاسم الموحد + النوع لعرض مزودي كل موديل بترتيب الأولوية
  const grouped = React.useMemo(() => {
    const map = new Map<string, ModelMapping[]>();
    for (const m of mappings ?? []) {
      const key = `${m.canonical}::${m.type}`;
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([key, list]) => ({
        key,
        canonical: list[0].canonical,
        type: list[0].type,
        list: [...list].sort((a, b) => a.priority - b.priority || a.id - b.id),
      }))
      .sort((a, b) => a.canonical.localeCompare(b.canonical));
  }, [mappings]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="size-5 text-violet-400" aria-hidden />
          إدارة الموديلات
        </CardTitle>
        <CardDescription>
          الاسم الموحد (canonical) هو ما يطلبه عميل MCP — وكل خريطة تربطه باسم الموديل الفعلي لدى مزود معين مع رقم
          أولوية: الأولوية الأصغر تُجرَّب أولًا، وعند فشل مزود ينتقل للتالي تلقائيًا.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* نموذج الإضافة */}
        <form onSubmit={(e) => void handleAdd(e)} className="flex flex-col gap-2.5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mapping-canonical" className="text-xs font-medium text-muted-foreground">
                الاسم الموحد (canonical)
              </Label>
              <Input
                id="mapping-canonical"
                dir="ltr"
                value={canonical}
                onChange={(e) => setCanonical(e.target.value)}
                placeholder="gpt-image-2-6/flare-text-to-image"
                aria-label="الاسم الموحد للموديل"
                maxLength={120}
                spellCheck={false}
                className="h-11 font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-muted-foreground">النوع</Label>
              <Select value={type} onValueChange={(v) => setType(v === "video" ? "video" : "image")}>
                <SelectTrigger aria-label="نوع الموديل" className="h-11 w-full data-[size=default]:h-11">
                  <SelectValue placeholder="النوع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">صور</SelectItem>
                  <SelectItem value="video">فيديو</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-muted-foreground">المزود</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger aria-label="مزود الخريطة" className="h-11 w-full data-[size=default]:h-11">
                  <SelectValue placeholder="اختر مزودًا" />
                </SelectTrigger>
                <SelectContent>
                  {(providers ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {PROVIDER_LABELS[p.id] ?? p.name} ({p.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mapping-model" className="text-xs font-medium text-muted-foreground">
                اسم الموديل لدى المزود
              </Label>
              <Input
                id="mapping-model"
                dir="ltr"
                value={providerModelName}
                onChange={(e) => setProviderModelName(e.target.value)}
                placeholder="gpt-image-2.6-flare-text-to-image"
                aria-label="اسم الموديل كما يُرسل للمزود"
                maxLength={160}
                spellCheck={false}
                className="h-11 font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mapping-priority" className="text-xs font-medium text-muted-foreground">
                الأولوية (الأصغر أولًا)
              </Label>
              <Input
                id="mapping-priority"
                dir="ltr"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                aria-label="أولوية تجربة هذا المزود"
                className="h-11 font-mono text-xs"
              />
            </div>
          </div>

          <Button type="submit" disabled={adding} className="h-11 w-full sm:w-auto" aria-label="إضافة خريطة موديل">
            {adding ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            إضافة خريطة
          </Button>
        </form>

        {/* القائمة مجمّعة حسب الموديل */}
        {mappings === null && !loadFailed ? (
          <div className="flex flex-col gap-2" aria-hidden>
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : loadFailed && mappings === null ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 py-8 text-center">
            <p className="text-sm font-medium text-rose-200">تعذّر تحميل خرائط الموديلات</p>
            <Button variant="outline" className="h-11" onClick={() => void load()}>
              <RefreshCw className="size-4" aria-hidden />
              إعادة المحاولة
            </Button>
          </div>
        ) : mappings !== null && mappings.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <Boxes className="size-8 text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-medium">لا توجد خرائط بعد</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              اربط كل موديل بمزود واحد أو أكثر — التوليد يمرّ على المزودين حسب الأولوية ثم على مفاتيح كل مزود بالترتيب.
            </p>
          </div>
        ) : mappings !== null ? (
          <div className="scrollbar-thin max-h-[22rem] overflow-y-auto pe-1">
            <ol className="flex flex-col gap-2.5">
              {grouped.map((group) => {
                const typeMeta = TYPE_META[group.type];
                const TypeIcon = typeMeta?.icon ?? ImageIcon;
                return (
                  <li key={group.key} className="rounded-lg border bg-muted/10 p-3 transition-colors hover:border-violet-500/40">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={typeMeta ? `inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${typeMeta.chipClass}` : "rounded-md border px-2 py-0.5 text-xs"}
                      >
                        <TypeIcon className="size-3.5" aria-hidden />
                        {typeMeta?.label ?? group.type}
                      </span>
                      <code dir="ltr" className="font-mono text-xs text-foreground/90">
                        {group.canonical}
                      </code>
                    </div>

                    <ol className="mt-2 flex flex-col gap-1.5">
                      {group.list.map((m, mi) => (
                        <MappingRow
                          key={m.id}
                          mapping={m}
                          order={mi + 1}
                          busy={busyId === m.id}
                          onToggle={() => void handleToggle(m)}
                          onDelete={() => void handleDelete(m)}
                        />
                      ))}
                    </ol>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* -------------------------------- صف خريطة -------------------------------- */

function MappingRow({
  mapping: m,
  order,
  busy,
  onToggle,
  onDelete,
}: {
  mapping: ModelMapping;
  order: number;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const providerLabel = PROVIDER_LABELS[m.provider_id] ?? m.provider_id;
  return (
    <li className="rounded-md border bg-background/40 p-2.5 transition-colors hover:border-violet-500/40">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span
          aria-label={`ترتيب أولوية ${order}`}
          title="الأولوية الأصغر تُجرَّب أولًا"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 font-mono text-[11px] font-bold text-foreground/80"
        >
          {order}
        </span>
        <Badge
          variant="outline"
          dir="ltr"
          className="border-teal-500/30 bg-teal-500/10 font-mono text-[11px] text-teal-300"
        >
          {providerLabel}
        </Badge>
        <code dir="ltr" className="font-mono text-[11px] text-muted-foreground">
          {m.provider_model_name}
        </code>
        {m.enabled ? (
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/15 text-[11px] text-emerald-300">
            مفعّلة
          </Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/15 text-[11px] text-amber-300">
            معطّلة
          </Badge>
        )}

        <span className="ms-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-11 px-3"
            disabled={busy}
            onClick={onToggle}
            aria-label={m.enabled ? `تعطيل خريطة ${m.canonical} عبر ${providerLabel}` : `تفعيل خريطة ${m.canonical} عبر ${providerLabel}`}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Power className="size-4" aria-hidden />}
            {m.enabled ? "تعطيل" : "تفعيل"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 px-3 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                disabled={busy}
                aria-label={`حذف خريطة ${m.canonical} عبر ${providerLabel}`}
              >
                <Trash2 className="size-4" aria-hidden />
                حذف
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>حذف خريطة الموديل؟</AlertDialogTitle>
                <AlertDialogDescription>
                  سيُحذف رابط «{m.canonical}» بالمزود <span dir="ltr" className="font-mono">{providerLabel}</span>. إذا كانت
                  آخر خريطة لهذا الموديل فلن يكون قابلًا للتوليد حتى تضيف خريطة أخرى.
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
    </li>
  );
}
