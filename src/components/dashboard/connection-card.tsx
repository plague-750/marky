"use client";

import * as React from "react";
import { Check, Copy, ShieldCheck, Waypoints } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { copyText, type HealthResponse } from "./shared";

const TOOLS: Array<{ name: string; desc: string }> = [
  { name: "generate_image", desc: "توليد صورة من وصف نصي" },
  { name: "generate_video", desc: "توليد فيديو مع صوت متزامن أصلي" },
  { name: "merge_videos", desc: "دمج عدة مقاطع (2-10) في فيديو واحد — يُحذف الناتج بعد ~24 ساعة" },
  { name: "get_task", desc: "متابعة حالة أي مهمة بمعرّفها (حد أقصى 600 ثانية للصور و1800 للفيديو)" },
  { name: "list_media", desc: "استرجاع أحدث الوسائط المخزنة بروابطها" },
  { name: "retry_task", desc: "إعادة محاولة مهمة عالقة أو فاشلة فورًا — اختياريًا على مزود محدد" },
];

/** البطاقة (هـ): ربط السيرفر — رابط MCP + إعدادات العملاء + الأدوات الست. */
export function ConnectionCard({ health, className }: { health: HealthResponse | null; className?: string }) {
  const { toast } = useToast();
  const [mcpUrl, setMcpUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // حساب الرابط بعد التحميل لتفادي اختلاف SSR
  React.useEffect(() => {
    setMcpUrl(`${window.location.origin}/mcp`);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const authRequired = health?.authRequired === true;

  const handleCopy = React.useCallback(
    async (text: string, id: string) => {
      const ok = await copyText(text);
      if (ok) {
        setCopied(id);
        toast({ title: "تم النسخ" });
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(null), 2000);
      } else {
        toast({ title: "تعذّر النسخ", description: "حدّد النص وانسخه يدويًا", variant: "destructive" });
      }
    },
    [toast],
  );

  const chatgptJson = React.useMemo(() => {
    if (!mcpUrl) return "";
    const entry: Record<string, unknown> = { url: mcpUrl };
    if (authRequired) entry.headers = { Authorization: "Bearer <TOKEN>" };
    return JSON.stringify({ mcpServers: { "media-generator": entry } }, null, 2);
  }, [mcpUrl, authRequired]);

  const claudeJson = React.useMemo(() => {
    if (!mcpUrl) return "";
    return JSON.stringify(
      { mcpServers: { "media-generator": { type: "http", url: mcpUrl } } },
      null,
      2,
    );
  }, [mcpUrl]);

  const cursorJson = React.useMemo(() => {
    if (!mcpUrl) return "";
    return JSON.stringify({ mcpServers: { "media-generator": { url: mcpUrl } } }, null, 2);
  }, [mcpUrl]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Waypoints className="size-5 text-amber-400" aria-hidden />
          ربط السيرفر
        </CardTitle>
        <CardDescription>
          انسخ رابط خادم MCP وأضفه إلى عميلك المفضل للتحكم بالأدوات مباشرة من الدردشة.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* رابط MCP */}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">رابط خادم MCP</span>
            {authRequired ? (
              <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/15 text-amber-300">
                <ShieldCheck className="size-3" aria-hidden />
                يتطلب رمز وصول (Bearer)
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {mcpUrl ? (
              <Input
                readOnly
                dir="ltr"
                value={mcpUrl}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="رابط MCP"
                className="h-11 flex-1 font-mono text-xs"
              />
            ) : (
              <Skeleton className="h-11 flex-1" aria-hidden />
            )}
            <Button
              variant="outline"
              className="h-11 sm:w-28"
              disabled={!mcpUrl}
              onClick={() => mcpUrl && void handleCopy(mcpUrl, "url")}
              aria-label="نسخ رابط MCP"
            >
              {copied === "url" ? (
                <Check className="size-4 text-emerald-400" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              نسخ
            </Button>
          </div>
        </div>

        <Separator />

        {/* إعدادات العملاء */}
        <Tabs defaultValue="chatgpt" className="gap-3">
          <TabsList className="grid h-11 w-full grid-cols-3">
            <TabsTrigger value="chatgpt" className="text-[11px] sm:text-sm">
              ChatGPT / GPT Agents
            </TabsTrigger>
            <TabsTrigger value="claude" className="text-[11px] sm:text-sm">
              Claude Desktop
            </TabsTrigger>
            <TabsTrigger value="cursor" className="text-[11px] sm:text-sm">
              Cursor / Windsurf / Cline
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chatgpt" className="flex flex-col gap-2">
            <JsonBlock json={chatgptJson} id="chatgpt" onCopy={handleCopy} copied={copied} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              في ChatGPT: Settings → Connectors → Create → Custom MCP server وضع الرابط في Server URL
            </p>
          </TabsContent>

          <TabsContent value="claude" className="flex flex-col gap-2">
            <JsonBlock json={claudeJson} id="claude" onCopy={handleCopy} copied={copied} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              أضفه إلى ملف <code dir="ltr" className="font-mono">claude_desktop_config.json</code>
            </p>
          </TabsContent>

          <TabsContent value="cursor" className="flex flex-col gap-2">
            <JsonBlock json={cursorJson} id="cursor" onCopy={handleCopy} copied={copied} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              أضفه إلى ملف <code dir="ltr" className="font-mono">mcp.json</code>
            </p>
          </TabsContent>
        </Tabs>

        <Separator />

        {/* الأدوات الست */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">الأدوات الست</h3>
          <ul className="flex flex-col gap-2">
            {TOOLS.map((tool) => (
              <li
                key={tool.name}
                className="flex flex-col gap-1.5 rounded-lg border bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
              >
                <code
                  dir="ltr"
                  className="w-fit shrink-0 rounded-md border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 font-mono text-xs text-violet-300"
                >
                  {tool.name}
                </code>
                <span className="text-xs leading-relaxed text-muted-foreground">{tool.desc}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ملاحظة الانتظار للفيديو */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-sm leading-relaxed text-amber-200">
            الفيديو يحتاج دقائق: يعيد السيرفر <code dir="ltr" className="font-mono">task_id</code> فورًا، ويتابَع
            تلقائيًا بـ <code dir="ltr" className="font-mono">get_task</code> كل 10 ثوانٍ — وعند اكتمال المهمة يُعرض
            الرابط في الدردشة ويتوقف. أثناء الانتظار يُبَث تقدم حي (Progress notifications) حتى لا تنقطع العملية.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ----------------------------- كتلة JSON قابلة للنسخ ----------------------------- */

function JsonBlock({
  json,
  id,
  onCopy,
  copied,
}: {
  json: string;
  id: string;
  onCopy: (text: string, id: string) => void;
  copied: string | null;
}) {
  return (
    <div className="rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between border-b px-3 py-1">
        <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">
          JSON
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-11 px-2 text-xs"
          onClick={() => onCopy(json, id)}
          aria-label="نسخ إعداد JSON"
        >
          {copied === id ? (
            <Check className="size-4 text-emerald-400" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
          {copied === id ? "تم" : "نسخ"}
        </Button>
      </div>
      <pre
        dir="ltr"
        className="scrollbar-thin max-h-52 overflow-auto p-3 text-left font-mono text-xs leading-relaxed text-foreground/90"
      >
        {json}
      </pre>
    </div>
  );
}
