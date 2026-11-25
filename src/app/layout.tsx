import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "MCP Media Generator — خادم توليد الوسائط بالذكاء الاصطناعي",
  description:
    "لوحة تحكم عربية لإدارة مفاتيح مزودي توليد الصور والفيديو (kie.ai وCometAPI)، متابعة المهام الحية، وربط عملاء MCP مثل ChatGPT وClaude وCursor عبر بروتوكول Streamable HTTP.",
  keywords: [
    "MCP",
    "توليد الصور",
    "توليد الفيديو",
    "دمج الفيديو",
    "الذكاء الاصطناعي",
    "kie.ai",
    "CometAPI",
    "Streamable HTTP",
  ],
  authors: [{ name: "MCP Media Generator" }],
  // الأيقونة تُسجَّل تلقائيًا من src/app/icon.svg (ملف محلي بدل رابط خارجي)
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className="dark" suppressHydrationWarning>
      {/* suppressHydrationWarning هنا مقصودة: بعض إضافات المتصفح تحقن خصائص على <body>
          (مثل bis_status و__processed_...) قبل تحميل React — فهذا يتجاهل تعارض الخصائص
          على هذا الوسم فقط دون إخفاء أي أخطاء حقيقية داخل الصفحة */}
      <body className="antialiased bg-background text-foreground" suppressHydrationWarning>
        {/* React يرفع روابط الخطوط تلقائيًا إلى <head> */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap"
        />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
