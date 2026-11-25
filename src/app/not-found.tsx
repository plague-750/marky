import Link from "next/link";
import { Home, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * صفحة 404 مخصصة بتصميم اللوحة نفسها — تستبدل الصفحة الافتراضية لـ Next.js
 * (التي تعرض شعار Next.js) بصفحة عربية داكنة متناسقة مع الهوية الزجاجية.
 */
export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      {/* هالات زجاجية خلفية بنفس ألوان اللوحة (بنفسجي + زمردي) */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 size-72 rounded-full bg-violet-500/15 blur-3xl" />
        <div className="absolute bottom-0 left-1/5 size-72 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-16">
        <section
          aria-label="خطأ 404 — الصفحة غير موجودة"
          className="w-full max-w-md rounded-2xl border border-border/60 bg-card/50 p-8 text-center shadow-2xl backdrop-blur-md"
        >
          <div className="mx-auto flex size-14 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/15 text-violet-300">
            <SearchX className="size-7" aria-hidden />
          </div>

          <p
            dir="ltr"
            className="mt-6 bg-gradient-to-l from-emerald-300 via-violet-300 to-violet-400 bg-clip-text text-6xl font-extrabold leading-none text-transparent"
          >
            404
          </p>

          <h1 className="mt-3 text-xl font-bold">الصفحة غير موجودة</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            الرابط اللي فتحته مش موجود أو اتغيّر. لو كنت بتختبر خادم MCP فاستخدم عميل متوافق مع
            Streamable HTTP على المسار{" "}
            <span dir="ltr" className="font-mono text-foreground">
              /mcp
            </span>
            .
          </p>

          <Button asChild size="lg" className="mt-6 w-full">
            <Link href="/">
              <Home className="size-4" aria-hidden />
              رجوع إلى لوحة التحكم
            </Link>
          </Button>
        </section>
      </main>

      <footer className="relative z-10 mt-auto border-t border-border/60 py-4 text-center text-xs text-muted-foreground">
        MCP Media Generator
      </footer>
    </div>
  );
}
