"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { KeyRound, Layers, Loader2, Pencil, Plus, Power, RefreshCw, Trash2, Video } from "lucide-react";
import { Image as ImageIcon } from "lucide-react";

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
  capabilityLabel,
  detectProtocolFromName,
  formatRelativeAr,
  groupKeysByName,
  PROVIDER_LABELS,
  PROVIDERS_CHANGED_EVENT,
  type ApiKey,
  type ApiName,
  type KeyCapability,
  type KeysResponse,
  type ProviderId,
  type ProviderRow,
  type ProvidersResponse,
} from "./shared";

/** خيارات طريقة الاتصال الاحتياطية عند تعذر تحميل قائمة المزودين من السيرفر */
const DEFAULT_PROTOCOL_OPTIONS: ProviderRow[] = [
  { id: "kie", name: "kie.ai", base_url: "https://api.kie.ai", auth_type: "bearer", auth_header: "Authorization", adapter_type: "kie", image_endpoint: "", video_endpoint: "", check_endpoint: "", enabled: 1, created_at: "" },
  { id: "cometapi", name: "CometAPI", base_url: "https://api.cometapi.com", auth_type: "bearer", auth_header: "Authorization", adapter_type: "cometapi", image_endpoint: "", video_endpoint: "", check_endpoint: "", enabled: 1, created_at: "" },
];

const STATUS_META: Record<ApiKey["status"], { label: string; badgeClass: string }> = {
  active: { label: "نشط", badgeClass: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
  exhausted: { label: "مستنزف", badgeClass: "border-amber-500/30 bg-amber-500/15 text-amber-300" },
  disabled: { label: "معطّل", badgeClass: "border-border bg-muted text-muted-foreground" },
};

const DATALIST_ID = "api-name-suggestions";

interface ApiErrorBody {
  error?: string;
}

/* --------------------- مُنتقي استخدام المفتاح (صور/فيديو) --------------------- */

const CAPABILITY_OPTIONS: { value: KeyCapability; label: string; icon: LucideIcon }[] = [
  { value: "both", label: "صور وفيديو", icon: Layers },
  { value: "image", label: "صور فقط", icon: ImageIcon },
  { value: "video", label: "فيديو فقط", icon: Video },
];

function CapabilityPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: KeyCapability;
  onChange: (v: KeyCapability) => void;
  idPrefix: string;
}) {
  return (
    <div role="radiogroup" aria-label="استخدام المفتاح — للصور أم للفيديو" className="grid grid-cols-3 gap-1.5">
      {CAPABILITY_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            id={`${idPrefix}-${opt.value}`}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex h-11 flex-col items-center justify-center gap-0.5 rounded-md border px-1 text-[11px] font-medium transition-colors",
              selected
                ? "border-violet-500/50 bg-violet-500/15 text-violet-200"
                : "border-border bg-muted/20 text-muted-foreground hover:border-violet-500/30 hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** البطاقة (أ): إدارة المفاتيح — تجمّع المفاتيح تحت اسم الـ API الحر الذي يكتبه المستخدم،
 *  مع تحديد استخدام كل مفتاح (صور/فيديو) وتجربة تسلسلية داخل الاسم ثم الاسم التالي. */
export function KeyManager({ className }: { className?: string }) {
  const { toast } = useToast();

  const [keys, setKeys] = React.useState<ApiKey[] | null>(null);
  const [names, setNames] = React.useState<ApiName[]>([]);
  const [providers, setProviders] = React.useState<ProviderRow[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);

  const [apiName, setApiName] = React.useState("");
  const [protocol, setProtocol] = React.useState<string>("kie");
  const [capability, setCapability] = React.useState<KeyCapability>("both");
  const [apiKey, setApiKey] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [editingKey, setEditingKey] = React.useState<ApiKey | null>(null);

  // اختار المستخدم البروتوكول يدويًا؟ عندئذ نتوقف عن المزامنة التلقائية مع الاسم
  const manualProtocol = React.useRef(false);

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
    // قائمة المزودين (طريقة الاتصال) ديناميكية من قاعدة البيانات — فشلها لا يمنع المفاتيح
    try {
      const pRes = await fetch("/api/providers", { cache: "no-store" });
      if (pRes.ok) {
        const pData = (await pRes.json()) as ProvidersResponse;
        setProviders(Array.isArray(pData.providers) ? pData.providers : []);
      }
    } catch {
      // اترك null — تستخدم الخيارات الاحتياطية
    }
  }, []);

  React.useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  // تحديث فوري لقائمة «طريقة الاتصال» عند إضافة/تعديل مزود من «إدارة المزودين»
  React.useEffect(() => {
    const handler = () => void loadKeys();
    window.addEventListener(PROVIDERS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(PROVIDERS_CHANGED_EVENT, handler);
  }, [loadKeys]);

  const handleNameChange = (value: string) => {
    setApiName(value);
    if (!value.trim()) {
      // الاسم فُرغ — نعيد السماح بالمزامنة التلقائية
      manualProtocol.current = false;
      return;
    }
    if (manualProtocol.current) return;
    // 1) الاسم المحفوظ مسبقًا يأخذ مزوده المحفوظ  2) وإلا الاستنتاج من الكلمات المفتاحية
    const saved = names.find((n) => n.name.toLowerCase() === value.trim().toLowerCase());
    const detected = detectProtocolFromName(value);
    if (saved && saved.protocol) setProtocol(saved.protocol);
    else if (detected) setProtocol(detected);
  };

  const handleProtocolChange = (v: string) => {
    manualProtocol.current = true;
    setProtocol(v);
  };

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = apiName.trim();
    const trimmedKey = apiKey.trim();
    if (!name) {
      toast({
        title: "اسم الـ API مطلوب",
        description: "اكتب أي اسم تحبه — المفاتيح تتجمّع تحت هذا الاسم ويُحفظ تلقائيًا",
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
        body: JSON.stringify({ provider: name, protocol, capability, api_key: trimmedKey }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { key?: ApiKey } | null;
        toast({
          title: "تمت إضافة المفتاح",
          description: data?.key?.masked_key
            ? `«${name}» — ${capabilityLabel(capability)} — المفتاح: ${data.key.masked_key}`
            : `«${name}» — ${capabilityLabel(capability)} — جاهز للتجربة التسلسلية`,
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
    // إعادة تحميل القائمة ليُحدَّث سجل الأسماء المحفوظة (الاقتراحات) فورًا
    void loadKeys();
  };

  // تجميع المفاتيح حسب اسم الـ API الحر — نفس ترتيب التجربة التسلسلية في السيرفر
  const groups = React.useMemo(() => groupKeysByName(keys ?? []), [keys]);

  // ملخص الاستخدام لكل مجموعة — يجيب مباشرة على «هل المفتاح للصور أم للفيديو»
  const groupSummary = (groupKeys: ApiKey[]): string => {
    const counts: Record<KeyCapability, number> = { both: 0, image: 0, video: 0 };
    for (const k of groupKeys) counts[k.capability] = (counts[k.capability] ?? 0) + 1;
    const parts: string[] = [];
    if (counts.both) parts.push(`صور وفيديو (${counts.both})`);
    if (counts.image) parts.push(`صور فقط (${counts.image})`);
    if (counts.video) parts.push(`فيديو فقط (${counts.video})`);
    return parts.join(" · ") || "—";
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5 text-violet-400" aria-hidden />
          مدير المفاتيح
        </CardTitle>
        <CardDescription>
          اكتب أي اسم تحبه للـ API (مثال: حسابي الأساسي، CometAPI ثاني) — يُحفظ تلقائيًا وتتجمّع مفاتيحه معًا. حدّد لكل
          مفتاح استخدامه: صور أو فيديو أو الاثنين. التجربة تسلسلية: مفاتيح الاسم الأول بالترتيب ثم الاسم التالي، مع
          تبديل فوري تلقائي عند أي خطأ أو نفاد رصيد دون توقف.
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
                aria-label="اسم الـ API — نص حر يُحفظ تلقائيًا وتتجمّع مفاتيحه تحت هذا الاسم"
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
              <label htmlFor="protocol-select" className="text-xs font-medium text-muted-foreground">
                طريقة الاتصال (حسب موقع المفتاح)
              </label>
              <Select value={protocol} onValueChange={handleProtocolChange}>
                <SelectTrigger id="protocol-select" aria-label="طريقة الاتصال" className="h-11 w-full data-[size=default]:h-11">
                  <SelectValue placeholder="الطريقة" />
                </SelectTrigger>
                <SelectContent>
                  {(providers ?? DEFAULT_PROTOCOL_OPTIONS).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {PROVIDER_LABELS[p.id] ?? p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* توضيح العلاقة بين الاسم وطريقة الاتصال — يتغير حسب الاسم المكتوب */}
          <ProtocolHint apiName={apiName} protocol={protocol} names={names} />

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              استخدام المفتاح — للصور أم للفيديو؟
            </span>
            <CapabilityPicker value={capability} onChange={setCapability} idPrefix="add-cap" />
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

        {/* القائمة مجمّعة حسب اسم الـ API */}
        {keys === null && !loadFailed ? (
          <div className="flex flex-col gap-2" aria-hidden>
            <Skeleton className="h-[110px] w-full rounded-lg" />
            <Skeleton className="h-[110px] w-full rounded-lg" />
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
              اكتب اسم الـ API، اختر طريقة الاتصال حسب موقع المفتاح، حدّد الاستخدام (صور/فيديو) ثم ألصق المفتاح. أضف عدة
              مفاتيح تحت نفس الاسم لتجربتها بالترتيب واحدًا تلو الآخر.
            </p>
          </div>
        ) : keys !== null && groups.length > 0 ? (
          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              الترتيب التسلسلي: داخل كل اسم يُجرَّب المفتاح 1 ثم 2 ثم 3… وعند نفادها كلها ينتقل تلقائيًا للاسم التالي —
              التوليد يستخدم فقط المفاتيح المطابقة لنوعه (صور/فيديو).
            </p>
            <div className="scrollbar-thin max-h-[26rem] overflow-y-auto pe-1">
              <ol className="flex flex-col gap-2.5">
                {groups.map((group, gi) => (
                  <li
                    key={`${group.name}-${gi}`}
                    className="rounded-lg border bg-muted/10 p-3 transition-colors hover:border-violet-500/40"
                  >
                    {/* رأس مجموعة اسم الـ API */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        aria-label={`ترتيب الاسم ${gi + 1} في التجربة التسلسلية`}
                        title="ترتيب هذا الاسم في التجربة التسلسلية"
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-violet-500/40 bg-violet-500/10 font-mono text-[11px] font-bold text-violet-300"
                      >
                        {gi + 1}
                      </span>
                      <span className="text-sm font-bold">{group.name}</span>
                      <Badge
                        variant="outline"
                        dir="ltr"
                        className="border-teal-500/30 bg-teal-500/10 font-mono text-[11px] text-teal-300"
                      >
                        {PROVIDER_LABELS[group.protocol] ?? group.protocol}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {group.keys.length === 1 ? "مفتاح واحد" : `${group.keys.length} مفاتيح`}
                      </span>
                      {gi === 0 ? (
                        <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-300">
                          يُجرَّب أولًا
                        </Badge>
                      ) : null}
                      <span className="ms-auto text-[11px] text-muted-foreground">{groupSummary(group.keys)}</span>
                    </div>

                    {/* مفاتيح المجموعة — مرقّمة داخل الاسم */}
                    <ol className="mt-2 flex flex-col gap-1.5">
                      {group.keys.map((key, ki) => (
                        <KeyRow
                          key={key.id}
                          apiKey={key}
                          order={ki + 1}
                          busy={busyId === key.id}
                          deleteBusy={deletingId === key.id}
                          onToggle={() => void handleToggle(key)}
                          onDelete={() => void handleDelete(key)}
                          onEdit={() => setEditingKey(key)}
                        />
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : null}
      </CardContent>

      {/* حوار تعديل الاسم/الطريقة/الاستخدام */}
      <EditKeyDialog apiKey={editingKey} providers={providers} onClose={() => setEditingKey(null)} onSaved={handleEdited} />
    </Card>
  );
}

/* --------------------- توضيح الاسم ↔ طريقة الاتصال --------------------- */

function ProtocolHint({
  apiName,
  protocol,
  names,
}: {
  apiName: string;
  protocol: string;
  names: ApiName[];
}) {
  const name = apiName.trim();
  const protocolLabel = PROVIDER_LABELS[protocol] ?? protocol;

  if (!name) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        الاسم مجرد تسمية عندك تُحفظ كما كتبته — أما «طريقة الاتصال» فهي كيف يتكلم السيرفر فعليًا مع موقع المفتاح
        (kie.ai أو CometAPI). اكتب اسمًا يحتوي «kie» أو «comet» وسنضبط الطريقة تلقائيًا.
      </p>
    );
  }

  const saved = names.find((n) => n.name.toLowerCase() === name.toLowerCase());
  const detected = detectProtocolFromName(name);

  if (saved && saved.protocol) {
    return (
      <p className="text-[11px] leading-relaxed text-emerald-300/90">
        ✓ الاسم «{name}» محفوظ — طريقة الاتصال {PROVIDER_LABELS[saved.protocol] ?? saved.protocol} (المحفوظة سابقًا)
        {protocol === saved.protocol ? "" : ` — أنت الآن تختار ${protocolLabel}`}.
      </p>
    );
  }

  if (detected) {
    if (detected === protocol) {
      return (
        <p className="text-[11px] leading-relaxed text-emerald-300/90">
          ✓ الاسم يشير إلى {PROVIDER_LABELS[detected]} — ضُبطت طريقة الاتصال تلقائيًا وفقًا له.
        </p>
      );
    }
    return (
      <p className="text-[11px] leading-relaxed text-amber-300/90">
        ملاحظة: الاسم يشير إلى {PROVIDER_LABELS[detected]} لكنك اخترت {protocolLabel} يدويًا — تأكد أن المفتاح أصلًا من
        موقع {protocolLabel}.
      </p>
    );
  }

  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      المفاتيح تحت هذا الاسم ستتكلم ببروتوكول {protocolLabel} — غيّره من القائمة إذا كان المفتاح من موقع آخر.
    </p>
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
  const statusMeta = STATUS_META[key.status] ?? STATUS_META.disabled;
  const capMeta =
    key.capability === "image"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
      : key.capability === "video"
        ? "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300"
        : "border-violet-500/30 bg-violet-500/10 text-violet-300";

  return (
    <li className="rounded-md border bg-background/40 p-2.5 transition-colors hover:border-violet-500/40">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span
          aria-label={`ترتيب المفتاح ${order} داخل هذا الاسم`}
          title="ترتيب التجربة التسلسلية داخل هذا الاسم"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 font-mono text-[11px] font-bold text-foreground/80"
        >
          {order}
        </span>
        <code dir="ltr" className="font-mono text-[11px] text-muted-foreground">
          {key.masked_key}
        </code>
        <Badge variant="outline" className={cn("text-[11px]", capMeta)}>
          {capabilityLabel(key.capability)}
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
            aria-label={`تعديل المفتاح ${key.masked_key}`}
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

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          استخدام: {key.usage_count ?? 0} | نجاح: {key.success_count ?? 0} | فشل: {key.fail_count ?? 0}
        </span>
        <span aria-hidden>•</span>
        <span>أُضيف {formatRelativeAr(key.created_at)}</span>
      </div>

      {key.last_error ? (
        <p dir="auto" className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
          آخر خطأ: {key.last_error}
        </p>
      ) : null}
    </li>
  );
}

/* --------------------------- حوار التعديل --------------------------- */

function EditKeyDialog({
  apiKey: key,
  providers,
  onClose,
  onSaved,
}: {
  apiKey: ApiKey | null;
  providers: ProviderRow[] | null;
  onClose: () => void;
  onSaved: (updated: ApiKey) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [protocol, setProtocol] = React.useState<string>("kie");
  const [capability, setCapability] = React.useState<KeyCapability>("both");
  const [saving, setSaving] = React.useState(false);
  const initializedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (key && initializedFor.current !== key.id) {
      setName(key.provider ?? "");
      setProtocol(key.protocol || "kie");
      setCapability(key.capability === "image" ? "image" : key.capability === "video" ? "video" : "both");
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
        body: JSON.stringify({ provider: trimmed, protocol, capability }),
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
        description: `الاسم «${trimmed}» — ${capabilityLabel(capability)} — محفوظ في الاقتراحات أيضًا`,
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
          <DialogTitle>تعديل المفتاح</DialogTitle>
          <DialogDescription>
            المفتاح: <code dir="ltr" className="font-mono">{key?.masked_key}</code> — غيّر الاسم أو طريقة الاتصال أو
            الاستخدام وسيُحفظ تلقائيًا.
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
            <label className="text-xs font-medium text-muted-foreground">طريقة الاتصال (حسب موقع المفتاح)</label>
            <Select value={protocol} onValueChange={(v) => setProtocol(v)}>
              <SelectTrigger aria-label="طريقة الاتصال" className="h-11 w-full data-[size=default]:h-11">
                <SelectValue placeholder="الطريقة" />
              </SelectTrigger>
              <SelectContent>
                {(providers ?? DEFAULT_PROTOCOL_OPTIONS).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {PROVIDER_LABELS[p.id] ?? p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">استخدام المفتاح — للصور أم للفيديو؟</span>
            <CapabilityPicker value={capability} onChange={setCapability} idPrefix="edit-cap" />
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
