"use client";

import { Database, RefreshCw, Server, Sparkles, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { HealthResponse } from "./shared";

const OK_BADGE = "border-emerald-500/30 bg-emerald-500/15 text-emerald-300";
const DOWN_BADGE = "border-rose-500/30 bg-rose-500/15 text-rose-300";
const WARN_BADGE = "border-amber-500/30 bg-amber-500/15 text-amber-300";

interface DashboardHeaderProps {
  health: HealthResponse | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}

/** ترويسة لاصقة أعلى الصفحة مع شارات الحالة المُستقصاة كل 15 ثانية. */
export function DashboardHeader({ health, loading, failed, onRetry }: DashboardHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/15 text-violet-300">
            <Sparkles className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-base font-extrabold leading-tight sm:text-lg">مولّد الوسائط MCP</h1>
            <p className="text-xs text-muted-foreground">
              لوحة تحكم لتوليد الصور والفيديو ودمج المقاطع بالذكاء الاصطناعي
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {loading ? (
            <>
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-6 w-36 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </>
          ) : health ? (
            <>
              <Badge variant="outline" className={cn("gap-1", health.database === "turso-connected" ? OK_BADGE : DOWN_BADGE)}>
                <Database className="size-3" aria-hidden />
                {health.database === "turso-connected" ? "Turso متصل" : "غير متصل"}
              </Badge>
              <Badge variant="outline" className={cn("gap-1", health.merger?.healthy ? OK_BADGE : WARN_BADGE)}>
                <Server className="size-3" aria-hidden />
                {health.merger?.healthy ? "خدمة الدمج جاهزة" : "غير متصلة"}
              </Badge>
              {failed ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                  onClick={onRetry}
                  aria-label="إعادة فحص الحالة"
                >
                  <RefreshCw className="size-4" aria-hidden />
                </Button>
              ) : null}
            </>
          ) : (
            <Badge variant="outline" className={cn("gap-1", DOWN_BADGE)}>
              <TriangleAlert className="size-3" aria-hidden />
              تعذّر جلب الحالة
            </Badge>
          )}
          <Badge variant="outline" dir="ltr" className="font-mono text-[11px] text-muted-foreground">
            MCP: {health?.mcpEndpoint ?? "/mcp"}
          </Badge>
        </div>
      </div>
    </header>
  );
}
