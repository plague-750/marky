/** تذييل الصفحة — يلتصق بأسفل الشاشة عبر mt-auto داخل حاوية flex. */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-auto border-t border-border/60 py-5">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-1.5 px-4 text-center text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6 sm:text-start">
        <p>
          خادم MCP لتوليد الوسائط — يعمل عبر بروتوكول Streamable HTTP على المسار{" "}
          <code dir="ltr" className="font-mono">
            /mcp
          </code>
        </p>
        <p>© {year} MCP Media Generator</p>
      </div>
    </footer>
  );
}
