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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  capabilityLabel,
  DEFAULT_PROVIDER_ROWS,
  formatRelativeAr,
  groupKeysByName,
  PROVIDER_LABELS,
  PROVIDERS_CHANGED_EVENT,
  resolveProtocolFromSite,
  type ApiKey,
  type ApiName,
  type KeyCapability,
  type KeysResponse,
  type ProviderRow,
  type ProvidersResponse,
  type SiteResolution,
} from "./shared";

const SITE_DATALIST_ID = "api-site-suggestions";
const SITE_DATALIST_ID_EDIT = "api-site-suggestions-edit";

const STATUS_META: Record<ApiKey["status"], { label: string; badgeClass: string }> = {
  active: { label: "نشط", badgeClass: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
  exhausted: { label: "مستنزف", badgeClass: "border-amber-500/30 bg-amber-500/15 text-amber-300" },
  disabled: { label: "معطّل", badgeClass: "border-border bg-muted text-muted-foreground" },
};

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

/** البطاقة (أ): إدارة المفاتيح — «طريقة الاتصال» حقل نصي حر (اسم/رابط/نوع موقع الـ API) يُحفظ كما كُتب،
 *  مع تحديد استخدام كل مفتاح (صور/فيديو) وتجربة تسلسلية داخل الموقع ثم الموقع التالي. */
export function KeyManager({ className }: { className?: string }) {
  const { toast } = useToast();

  const [keys, setKeys] = React.useState<ApiKey[] | null>(null);
  const [names, setNames] = React.useState<ApiName[]>([]);
  const [providers, setProviders] = React.useState<ProviderRow[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);

  const [site, setSite] = React.useState("");
  const [capability, setCapability] = React.useState<KeyCapability>("both");
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
    // قائمة المزودين (للمطابقة والاقتراحات) ديناميكية من قاعدة البيانات — فشلها لا يمنع المفاتيح
    try {
      const pRes = await fetch("/api/providers", { cache: "no-store" });
      if (pRes.ok) {
        const pData = (await pRes.json()) as ProvidersResponse;
        setProviders(Array.isArray(pData.providers) ? pData.providers : []);
      }
    } catch {
      // اترك null — تُستخدم الخيارات الاحتياطية في المطابقة والاقتراحات
    }
  }, []);

  React.useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  // تحديث فوري للاقتراحات والمطابقة عند إضافة/تعديل مزود من «إدارة المزودين»
  React.useEffect(() => {
    const handler = () => void loadKeys();
    window.addEventListener(PROVIDERS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(PROVIDERS_CHANGED_EVENT, handler);
  }, [loadKeys]);

  // الاقتراحات السريعة للحقل النصي الحر: النصوص المحفوظة سابقًا + أسماء وروابط المزودين من قاعدة البيانات
  const siteSuggestions = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (v: string) => {
      const t = v.trim();
      if (!t) return;
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(t);
    };
    for (const n of names) push(n.name);
    for (const p of providers ?? DEFAULT_PROVIDER_ROWS) {
      push(p.name);
      if (p.base_url) push(p.base_url);
    }
    return out;
  }, [names, providers]);

  // مطابقة حية أثناء الكتابة: النص الحر ← مزود من قاعدة البيانات (أو fallback لأول مزود مفعّل)
  const resolution: SiteResolution | null = React.useMemo(
    () => resolveProtocolFromSite(site, providers),
    [site, providers],
  );

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const siteText = site.trim();
    const trimmedKey = apiKey.trim();
    if (!siteText) {
      toast({
        title: "طريقة الاتصال مطلوبة",
        description: "اكتب اسم أو رابط موقع الـ API — النص يُحفظ تلقائيًا مع المفتاح",
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
    const resolved = resolveProtocolFromSite(siteText, providers);
    if (!resolved) {
      toast({
        title: "لا يوجد مزودون",
        description: "أضف مزودًا أولًا من «إدارة المزودين» ثم أعد المحاولة",
        variant: "destructive",
      });
      return;
    }
    // موقع معروف → بروتوكوله مباشرة؛ موقع جديد → يُنشأ مزودًا تلقائيًا في السيرفر (بلا أي خطوة يدوية)
    const providerLabel = PROVIDER_LABELS[resolved.protocol] ?? resolved.providerLabel;
    setAdding(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: siteText,
          protocol: resolved.matched ? resolved.protocol : "",
          auto_provision: true,
          capability,
          api_key: trimmedKey,
        }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { key?: ApiKey; auto_provisioned?: boolean } | null;
        const matchNote = data?.auto_provisioned
          ? `أُنشئ مزود جديد «${siteText}» تلقائيًا — سيُجرَّب بعد المزودين الحاليين، وعدّل رابطه من «إدارة المزودين»`
          : resolved.matched
            ? `الاتصال عبر «${providerLabel}»`
            : `اتصال عبر «${providerLabel}»`;
        toast({
          title: "تمت إضافة المفتاح",
          description: `«${siteText}» — ${capabilityLabel(capability)} — ${matchNote}${
            data?.key?.masked_key ? ` — المفتاح: ${data.key.masked_key}` : ""
          }`,
        });
        setSite("");
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
        description: `نص «${key.provider}» ما زال محفوظًا في الاقتراحات`,
      });
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const handleEdited = (updated: ApiKey) => {
    setKeys((prev) => (prev ? prev.map((k) => (k.id === updated.id ? updated : k)) : prev));
    // إعادة تحميل القائمة ليُحدَّث سجل النصوص المحفوظة (الاقتراحات) فورًا
    void loadKeys();
  };

  // تجميع المفاتيح حسب نص «طريقة الاتصال» المحفوظ — نفس ترتيب التجربة التسلسلية في السيرفر
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
          اكتب في «طريقة الاتصال» اسم أو رابط موقع الـ API بحرية — النص يُحفظ تلقائيًا مع المفتاح، وأي موقع جديد يُنشأ له
          مزود تلقائيًا ويُدرج في دورة التوليد بلا أي خطوة يدوية. حدّد لكل مفتاح استخدامه: صور أو فيديو أو الاثنين.
          التجربة تسلسلية: مفاتيح الموقع الأول بالترتيب ثم الموقع التالي، مع تبديل فوري تلقائي عند أي خطأ أو نفاد رصيد
          دون توقف.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* نموذج الإضافة */}
        <form onSubmit={(e) => void handleAdd(e)} className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="api-site-input" className="text-xs font-medium text-muted-foreground">
              طريقة الاتصال (حسب موقع المفتاح)
            </label>
            <Input
              id="api-site-input"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="اكتب اسم أو رابط موقع الـ API بحرية (مثال: kie.ai، CometAPI…)"
              aria-label="طريقة الاتصال — نص حر يُحفظ تلقائيًا: اسم أو رابط أو نوع موقع الـ API"
              list={SITE_DATALIST_ID}
              maxLength={60}
              className="h-11"
            />
            <datalist id={SITE_DATALIST_ID}>
              {siteSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          {/* توضيح حي: ماذا سيحدث للنص المكتوب عند الحفظ */}
          <SiteHint site={site} resolution={resolution} />

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

        {/* القائمة مجمّعة حسب نص طريقة الاتصال المحفوظ */}
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
              اكتب اسم أو رابط موقع الـ API في «طريقة الاتصال»، حدّد الاستخدام (صور/فيديو) ثم ألصق المفتاح. أضف عدة
              مفاتيح لنفس الموقع لتجربتها بالترتيب واحدًا تلو الآخر.
            </p>
          </div>
        ) : keys !== null && groups.length > 0 ? (
          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              الترتيب التسلسلي: داخل كل موقع يُجرَّب المفتاح 1 ثم 2 ثم 3… وعند نفادها كلها ينتقل تلقائيًا للموقع التالي —
              التوليد يستخدم فقط المفاتيح المطابقة لنوعه (صور/فيديو).
            </p>
            <div className="scrollbar-thin max-h-[26rem] overflow-y-auto pe-1">
              <ol className="flex flex-col gap-2.5">
                {groups.map((group, gi) => (
                  <li
                    key={`${group.name}-${gi}`}
                    className="rounded-lg border bg-muted/10 p-3 transition-colors hover:border-violet-500/40"
                  >
                    {/* رأس مجموعة الموقع المحفوظ */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        aria-label={`ترتيب الموقع ${gi + 1} في التجربة التسلسلية`}
                        title="ترتيب هذا الموقع في التجربة التسلسلية"
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

                    {/* مفاتيح المجموعة — مرقّمة داخل الموقع */}
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

      {/* حوار تعديل نص طريقة الاتصال / الاستخدام */}
      <EditKeyDialog
        apiKey={editingKey}
        providers={providers}
        suggestions={siteSuggestions}
        onClose={() => setEditingKey(null)}
        onSaved={handleEdited}
      />
    </Card>
  );
}

/* --------------------- توضيح حي للحقل النصي الحر --------------------- */

function SiteHint({
  site,
  resolution,
  keepLabel,
}: {
  site: string;
  resolution: SiteResolution | null;
  /** في سياق التعديل: بروتوكول المفتاح الحالي الذي يبقى كما هو عند عدم المطابقة */
  keepLabel?: string;
}) {
  const text = site.trim();
  if (!text || !resolution) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        اكتب بحرية اسم أو رابط أو نوع موقع الـ API — النص يُحفظ مع المفتاح ويظهر في الاقتراحات عند إعادة التحميل. إن
        طابق نصك مزودًا معروفًا (مثل kie.ai أو CometAPI) فسيُستخدم بروتوكوله تلقائيًا.
      </p>
    );
  }
  const label = PROVIDER_LABELS[resolution.protocol] ?? resolution.providerLabel;
  if (resolution.matched) {
    return (
      <p className="text-[11px] leading-relaxed text-emerald-300/90">
        ✓ سيُستخدم مزود «{label}» للاتصال الفعلي — والنص كما كتبته سيُحفظ مع المفتاح.
      </p>
    );
  }
  if (keepLabel) {
    return (
      <p className="text-[11px] leading-relaxed text-amber-300/90">
        «{text}» ليس من المزودين الحاليين — عند الحفظ سيُنشأ مزودًا جديدًا تلقائيًا ويرتبط المفتاح به بدل «{keepLabel}».
        أعد النص إلى قيمته السابقة إن أردت البقاء على المزود الحالي.
      </p>
    );
  }
  return (
    <p className="text-[11px] leading-relaxed text-amber-300/90">
      لم نتعرف على «{text}» كأحد المزودين الحاليين — سيُنشأ مزود جديد تلقائيًا عند إضافة المفتاح ويُجرَّب بعد المزودين
      الحاليين. عدّل رابطه ونوع محوله من «إدارة المزودين» متى شئت.
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
          aria-label={`ترتيب المفتاح ${order} داخل هذا الموقع`}
          title="ترتيب التجربة التسلسلية داخل هذا الموقع"
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
                  سيُحذف المفتاح (<code dir="ltr" className="font-mono">{key.masked_key}</code>) من «
                  {key.provider}» نهائيًا، ولا يمكن التراجع عن هذا الإجراء. النص المدخل نفسه سيبقى محفوظًا في
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
  suggestions,
  onClose,
  onSaved,
}: {
  apiKey: ApiKey | null;
  providers: ProviderRow[] | null;
  suggestions: string[];
  onClose: () => void;
  onSaved: (updated: ApiKey) => void;
}) {
  const { toast } = useToast();
  const [site, setSite] = React.useState("");
  const [capability, setCapability] = React.useState<KeyCapability>("both");
  const [saving, setSaving] = React.useState(false);
  const initializedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (key && initializedFor.current !== key.id) {
      // نعرض النص المحفوظ كما كتبه المستخدم (وليس معرّف المزود) — بنفس آلية باقي الحقول المحفوظة
      setSite(key.provider ?? "");
      setCapability(key.capability === "image" ? "image" : key.capability === "video" ? "video" : "both");
      initializedFor.current = key.id;
    }
    if (!key) initializedFor.current = null;
  }, [key]);

  // مطابقة حية للنص — إن طابق مزودًا نحدّث البروتوكول، وإلا نُبقي بروتوكول المفتاح الحالي كما هو
  const resolution = React.useMemo(
    () => (key ? resolveProtocolFromSite(site, providers) : null),
    [key, site, providers],
  );

  const handleSave = async () => {
    if (!key) return;
    const trimmed = site.trim();
    if (!trimmed) {
      toast({ title: "طريقة الاتصال مطلوبة", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // نص لم يتغير → لا نلمس البروتوكول إطلاقًا؛ تغيّر وطابق مزودًا → بروتوكوله؛
      // تغيّر ولم يطابق → يُنشأ مزودًا جديدًا تلقائيًا في السيرفر (بلا أي خطوة يدوية)
      const textChanged = trimmed !== (key.provider ?? "");
      const matchedProtocol = resolution?.matched ? resolution.protocol : null;
      const payload: Record<string, unknown> = { provider: trimmed, capability };
      if (textChanged || matchedProtocol) {
        payload.protocol = matchedProtocol ?? "";
        payload.auto_provision = true;
      }
      const res = await fetch(`/api/keys/${encodeURIComponent(key.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({ title: "تعذّر حفظ التعديلات", description: data?.error ?? "حاول مجددًا", variant: "destructive" });
        return;
      }
      const data = (await res.json().catch(() => null)) as { key?: ApiKey; auto_provisioned?: boolean } | null;
      if (data?.key) onSaved(data.key);
      const nextLabel = data?.auto_provisioned
        ? `أُنشئ مزود جديد «${trimmed}» تلقائيًا — سيُجرَّب بعد المزودين الحاليين، وعدّل رابطه من «إدارة المزودين»`
        : matchedProtocol
          ? `الاتصال عبر «${PROVIDER_LABELS[matchedProtocol] ?? resolution!.providerLabel}»`
          : "بروتوكول الاتصال السابق بقي كما هو";
      toast({
        title: "تم حفظ التعديلات",
        description: `«${trimmed}» — ${capabilityLabel(capability)} — ${nextLabel} — محفوظ في الاقتراحات أيضًا`,
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
            المفتاح: <code dir="ltr" className="font-mono">{key?.masked_key}</code> — غيّر نص طريقة الاتصال أو الاستخدام
            وسيُحفظ تلقائيًا.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-api-site" className="text-xs font-medium text-muted-foreground">
              طريقة الاتصال (حسب موقع المفتاح)
            </label>
            <Input
              id="edit-api-site"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="اكتب اسم أو رابط موقع الـ API بحرية"
              aria-label="طريقة الاتصال — نص حر يُحفظ تلقائيًا"
              list={SITE_DATALIST_ID_EDIT}
              maxLength={60}
              className="h-11"
            />
            <datalist id={SITE_DATALIST_ID_EDIT}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {resolution && key ? (
              <SiteHint
                site={site}
                resolution={resolution}
                keepLabel={PROVIDER_LABELS[key.protocol] ?? key.protocol}
              />
            ) : null}
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
