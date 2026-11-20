"use client";

import * as React from "react";
import {
  Clapperboard,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  TriangleAlert,
  Video,
  Wand2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { toAbsoluteUrl, type ApiKey, type GenerateResponse, type KeysResponse } from "./shared";

const IMAGE_ASPECTS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"];
const VIDEO_ASPECTS = ["auto", "16:9", "9:16", "1:1"];
const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"];
const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"];

interface ApiErrorBody {
  error?: string;
}

/**
 * استوديو التوليد — يجيب مباشرة على سؤال «كيف أستخدم المفتاح للصور أو للفيديو؟»:
 * اختر صورة أو فيديو، اكتب الوصف، والتوليد يمرّ عبر نفس مجمع المفاتيح المجمّع حسب
 * أسماء الـ API بالتجربة التسلسلية — المفاتيح غير المطابقة للاستخدام لا تدخل أصلًا.
 */
export function GenerationStudio({ className }: { className?: string }) {
  const { toast } = useToast();

  const [tab, setTab] = React.useState<"image" | "video">("image");
  const [prompt, setPrompt] = React.useState("");

  const [imageAspect, setImageAspect] = React.useState("auto");
  const [imageResolution, setImageResolution] = React.useState("1K");

  const [videoAspect, setVideoAspect] = React.useState("auto");
  const [videoResolution, setVideoResolution] = React.useState("480p");
  const [duration, setDuration] = React.useState(8);
  const [enableAudio, setEnableAudio] = React.useState(true);
  const [imageUrl, setImageUrl] = React.useState("");

  const [keys, setKeys] = React.useState<ApiKey[] | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [results, setResults] = React.useState<{ type: "image" | "video"; urls: string[] } | null>(null);
  const [submittedProcessing, setSubmittedProcessing] = React.useState(false);

  const loadKeys = React.useCallback(async () => {
    try {
      const res = await fetch("/api/keys", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as KeysResponse;
      setKeys(Array.isArray(data.keys) ? data.keys : []);
    } catch {
      // العدّاد استعراضي فقط — التوليد نفسه يعمل على السيرفر حتى لو فشل العد
    }
  }, []);

  React.useEffect(() => {
    void loadKeys();
    // مزامنة دورية خفيفة — تعداد المفاتيح يتغير عند الإضافة/التعطيل من مدير المفاتيح
    const id = setInterval(() => void loadKeys(), 10_000);
    const onFocus = () => void loadKeys();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadKeys]);

  // المفاتيح القابلة للاستخدام = غير المعطّلة (السيرفر يستثني disabled فقط) — مجمّعة حسب الاستخدام
  const usable = React.useMemo(() => keys?.filter((k) => k.status !== "disabled") ?? [], [keys]);
  const imageCount = usable.filter((k) => k.capability === "both" || k.capability === "image").length;
  const videoCount = usable.filter((k) => k.capability === "both" || k.capability === "video").length;
  const activeCount = tab === "image" ? imageCount : videoCount;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) {
      toast({ title: "الوصف مطلوب", description: "اكتب وصفًا لما تريد توليده أولًا", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    setSubmittedProcessing(false);
    try {
      const payload =
        tab === "image"
          ? {
              type: "image",
              prompt: trimmed,
              aspect_ratio: imageAspect,
              resolution: imageResolution,
            }
          : {
              type: "video",
              prompt: trimmed,
              aspect_ratio: videoAspect,
              resolution: videoResolution,
              duration,
              enable_audio: enableAudio,
              ...(imageUrl.trim() ? { image_url: imageUrl.trim() } : {}),
            };

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        toast({ title: "تعذّر بدء التوليد", description: body?.error ?? "حاول مجددًا", variant: "destructive" });
        return;
      }

      const data = (await res.json()) as GenerateResponse;

      if (data.outcome === "completed" && data.task.result_urls.length > 0) {
        setResults({ type: data.task.type === "video" ? "video" : "image", urls: data.task.result_urls });
        setSubmittedProcessing(false);
        toast({ title: "اكتمل التوليد", description: "النتيجة جاهزة بالأسفل — ويمكنك فتح الروابط" });
        return;
      }

      if (data.outcome === "failed") {
        toast({
          title: "فشل التوليد",
          description: data.task.error_message || "سبب غير معروف — يمكنك الضغط على توليد مرة أخرى",
          variant: "destructive",
        });
        return;
      }

      // قيد المعالجة — تتابعها لوحة المهام تلقائيًا
      setResults(null);
      setSubmittedProcessing(true);
      toast({
        title: "بدأ التوليد",
        description: "المهمة تعمل الآن — تابع تقدمها في «لوحة المهام» بالأسفل (تحديث كل 5 ثوانٍ)",
      });
    } catch {
      toast({ title: "تعذّر الاتصال بالسيرفر", description: "تحقق من الشبكة وحاول مجددًا", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="size-5 text-violet-400" aria-hidden />
          استوديو التوليد
        </CardTitle>
        <CardDescription>
          اختر صورة أو فيديو واكتب الوصف — التوليد يمرّ تلقائيًا عبر مفاتيحك بالترتيب التسلسلي مع التبديل الفوري عند أي
          خطأ أو نفاد رصيد. فقط المفاتيح المطابقة للاستخدام تُستخدم (صور → مفاتيح الصور، فيديو → مفاتيح الفيديو).
        </CardDescription>
        <CardAction>
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "text-[11px]",
                imageCount > 0
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                  : "border-amber-500/30 bg-amber-500/15 text-amber-300",
              )}
            >
              {keys === null ? "…" : `${imageCount} مفتاح صور`}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "text-[11px]",
                videoCount > 0
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                  : "border-amber-500/30 bg-amber-500/15 text-amber-300",
              )}
            >
              {keys === null ? "…" : `${videoCount} مفتاح فيديو`}
            </Badge>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="studio-prompt" className="text-xs font-medium text-muted-foreground">
              الوصف (prompt) — ماذا تريد أن تولّد؟
            </Label>
            <Textarea
              id="studio-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="مثال: مدينة عربية قديمة وقت الغروب بإضاءة سينمائية، تفاصيل عالية…"
              aria-label="وصف التوليد"
              rows={3}
              maxLength={4096}
              className="min-h-20 resize-y"
            />
          </div>

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v === "video" ? "video" : "image")}
            className="gap-3"
          >
            <TabsList className="grid w-full max-w-xs grid-cols-2" aria-label="نوع التوليد">
              <TabsTrigger value="image" className="gap-1.5">
                <ImageIcon className="size-4" aria-hidden />
                صورة
              </TabsTrigger>
              <TabsTrigger value="video" className="gap-1.5">
                <Video className="size-4" aria-hidden />
                فيديو
              </TabsTrigger>
            </TabsList>

            {/* خيارات الصورة */}
            <TabsContent value="image" className="mt-0">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="image-aspect" className="text-xs text-muted-foreground">
                    نسبة الأبعاد
                  </Label>
                  <Select value={imageAspect} onValueChange={setImageAspect}>
                    <SelectTrigger id="image-aspect" className="h-11 w-full data-[size=default]:h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_ASPECTS.map((a) => (
                        <SelectItem key={a} value={a} dir="ltr">
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="image-resolution" className="text-xs text-muted-foreground">
                    الدقة
                  </Label>
                  <Select value={imageResolution} onValueChange={setImageResolution}>
                    <SelectTrigger id="image-resolution" className="h-11 w-full data-[size=default]:h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_RESOLUTIONS.map((r) => (
                        <SelectItem key={r} value={r} dir="ltr">
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>

            {/* خيارات الفيديو */}
            <TabsContent value="video" className="mt-0">
              <div className="flex flex-col gap-2.5">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="video-aspect" className="text-xs text-muted-foreground">
                      نسبة الأبعاد
                    </Label>
                    <Select value={videoAspect} onValueChange={setVideoAspect}>
                      <SelectTrigger id="video-aspect" className="h-11 w-full data-[size=default]:h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIDEO_ASPECTS.map((a) => (
                          <SelectItem key={a} value={a} dir="ltr">
                            {a}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="video-resolution" className="text-xs text-muted-foreground">
                      الدقة
                    </Label>
                    <Select value={videoResolution} onValueChange={setVideoResolution}>
                      <SelectTrigger id="video-resolution" className="h-11 w-full data-[size=default]:h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIDEO_RESOLUTIONS.map((r) => (
                          <SelectItem key={r} value={r} dir="ltr">
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="video-duration" className="text-xs text-muted-foreground">
                      المدة (ثانية)
                    </Label>
                    <Input
                      id="video-duration"
                      dir="ltr"
                      type="number"
                      min={1}
                      max={15}
                      value={duration}
                      onChange={(e) => setDuration(Math.max(1, Math.min(15, Number(e.target.value) || 8)))}
                      className="h-11"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="video-audio" className="text-xs text-muted-foreground">
                      صوت مزامن
                    </Label>
                    <div className="flex h-11 items-center gap-2 rounded-md border bg-muted/20 px-3">
                      <Switch
                        id="video-audio"
                        checked={enableAudio}
                        onCheckedChange={setEnableAudio}
                        aria-label="تفعيل الصوت المزامن"
                      />
                      <span className="text-xs text-muted-foreground">{enableAudio ? "مفعّل" : "متوقف"}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="video-image-url" className="text-xs text-muted-foreground">
                    رابط صورة البداية (اختياري — صورة إلى فيديو)
                  </Label>
                  <Input
                    id="video-image-url"
                    dir="ltr"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://example.com/first-frame.jpg — اتركه فارغًا للنص إلى فيديو"
                    aria-label="رابط صورة البداية للفيديو"
                    className="h-11 font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* تنبيه غياب المفاتيح المطابقة */}
          {keys !== null && activeCount === 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                لا توجد مفاتيح جاهزة {tab === "image" ? "للصور" : "للفيديو"} — أضف مفتاحًا من «مدير المفاتيح» وحدّد
                استخدامه «{tab === "image" ? "صور فقط" : "فيديو فقط"}» أو «صور وفيديو».
              </span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              type="submit"
              disabled={submitting}
              className="h-11 min-w-36 gap-2"
              aria-label={tab === "image" ? "توليد صورة" : "توليد فيديو"}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : tab === "image" ? (
                <ImageIcon className="size-4" aria-hidden />
              ) : (
                <Clapperboard className="size-4" aria-hidden />
              )}
              {submitting ? "جارٍ التوليد…" : tab === "image" ? "توليد الصورة" : "توليد الفيديو"}
            </Button>
            {submittedProcessing ? (
              <p className="text-xs text-violet-300">
                المهمة قيد المعالجة الآن — تابعها في «لوحة المهام» بالأسفل، وستكتمل تلقائيًا.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">الفشل على مفتاح لا يوقف التوليد — ينتقل فورًا للتالي.</p>
            )}
          </div>
        </form>

        {/* النتائج الفورية (الصور المتزامنة تكتمل داخل الطلب) */}
        {results && results.urls.length > 0 ? (
          <div className="mt-4 rounded-lg border bg-muted/10 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-300">
              <Wand2 className="size-3.5" aria-hidden />
              النتيجة جاهزة
            </p>
            {results.type === "image" ? (
              <div className="flex flex-wrap gap-2">
                {results.urls.slice(0, 6).map((url, i) => (
                  <a
                    key={`studio-img-${i}`}
                    href={toAbsoluteUrl(url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="فتح الصورة بتبويب جديد"
                  >
                    <img
                      src={toAbsoluteUrl(url)}
                      alt={`نتيجة التوليد ${i + 1}`}
                      className="h-24 w-24 rounded-md border object-cover transition-opacity hover:opacity-80"
                    />
                  </a>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {results.urls.map((url, i) => (
                  <Button key={`studio-video-${i}`} asChild variant="outline" size="sm" className="h-11">
                    <a href={toAbsoluteUrl(url)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4" aria-hidden />
                      فتح الفيديو
                    </a>
                  </Button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
