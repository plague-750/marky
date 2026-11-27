"use client";

// كارت الإضافة السريعة — كل حاجة في فورم واحد: طريقة الاتصال + المفتاح + اسم الموديل (اختياري)
// بدون تعبئة خرائط يدوية: المزود يُنشأ تلقائيًا من النص، واسم الموديل غير المسجل يُمرَّر كما هو
import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PROVIDERS_CHANGED_EVENT } from "./shared";

type Capability = "both" | "image" | "video";

const CAPABILITY_CHOICES: { value: Capability; label: string }[] = [
  { value: "both", label: "صور وفيديو" },
  { value: "image", label: "صور فقط" },
  { value: "video", label: "فيديو فقط" },
];

interface QuickAddResponse {
  ok?: boolean;
  note?: string;
  error?: string;
  provider_created?: boolean;
  mapping_id?: number | null;
}

export function QuickAdd({ className }: { className?: string }) {
  const { toast } = useToast();
  const [provider, setProvider] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [model, setModel] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [capability, setCapability] = React.useState<Capability>("both");
  const [modelType, setModelType] = React.useState<"image" | "video">("image");
  const [busy, setBusy] = React.useState(false);

  const reset = () => {
    setApiKey("");
    setModel("");
    setBaseUrl("");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!provider.trim() || !apiKey.trim()) {
      toast({ title: "ناقص بيانات", description: "اكتب طريقة الاتصال والمفتاح على الأقل", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/quick-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.trim(),
          api_key: apiKey.trim(),
          capability,
          model: model.trim() || undefined,
          model_type: model.trim() ? modelType : undefined,
          base_url: baseUrl.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as QuickAddResponse;
      if (!res.ok || data.error) {
        toast({ title: "فشل الإضافة", description: data.error || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      window.dispatchEvent(new CustomEvent(PROVIDERS_CHANGED_EVENT));
      toast({
        title: "تمت الإضافة",
        description: data.note || "المزود والمفتاح جاهزان — جرّب التوليد فورًا",
      });
      reset();
    } catch {
      toast({ title: "خطأ شبكة", description: "تعذر الاتصال بالخادم — أعد المحاولة", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-amber-400" aria-hidden />
          إضافة سريعة — كل شيء في مكان واحد
        </CardTitle>
        <CardDescription>
          اكتب اسم أو رابط الموقع + المفتاح + اسم الموديل (اختياري) واضغط زر واحد: المزود يُنشأ تلقائيًا، والمفتاح يُضاف، واسم الموديل
          غير المسجل يُمرَّر كما هو — بدون خرائط يدوية.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3" aria-label="إضافة سريعة لمزود ومفتاح وموديل">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="qa-provider" className="text-xs text-muted-foreground">
                طريقة الاتصال — اسم أو رابط الموقع (مثل: OpenRouter)
              </label>
              <Input
                id="qa-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="اسم الموقع أو رابط الـ API"
                dir="ltr"
                className="text-left"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="qa-key" className="text-xs text-muted-foreground">
                مفتاح API
              </label>
              <Input
                id="qa-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                type="password"
                dir="ltr"
                className="text-left"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="qa-model" className="text-xs text-muted-foreground">
                اسم الموديل (اختياري — يُرسل كما هو للمزود)
              </label>
              <Input
                id="qa-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="مثل: recraft/recraft-v4.1-flash-v2:free"
                dir="ltr"
                className="text-left"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="qa-baseurl" className="text-xs text-muted-foreground">
                رابط الـ API الأساسي (اختياري — للمواقع الجديدة غير المعروفة)
              </label>
              <Input
                id="qa-baseurl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                dir="ltr"
                className="text-left"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div role="radiogroup" aria-label="استخدام المفتاح" className="flex gap-1.5">
              {CAPABILITY_CHOICES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={capability === c.value}
                  onClick={() => setCapability(c.value)}
                  className={cn(
                    "h-11 rounded-md border px-3 text-xs font-medium transition-colors",
                    capability === c.value
                      ? "border-violet-500/50 bg-violet-500/15 text-violet-200"
                      : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {model.trim() ? (
              <div role="radiogroup" aria-label="نوع الموديل" className="flex gap-1.5">
                {(["image", "video"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={modelType === t}
                    onClick={() => setModelType(t)}
                    className={cn(
                      "h-11 rounded-md border px-3 text-xs font-medium transition-colors",
                      modelType === t
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                        : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t === "image" ? "موديل صور" : "موديل فيديو"}
                  </button>
                ))}
              </div>
            ) : null}
            <Button type="submit" disabled={busy} className="ms-auto h-11 min-w-40 gap-2">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {busy ? "جاري الإضافة..." : "إضافة كل شيء"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
