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
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
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
