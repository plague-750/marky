// أدوات HTTP مشتركة: ترويسات CORS، ردود JSON، أساس الروابط، وخطأ موحّد

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// خطأ يحمل رمز HTTP ورسالة عربية
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// رد JSON مع ترويسات CORS
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

// رد خطأ بالشكل المتعارض عليه {"error":"..."}
export function errorResponse(status: number, message: string): Response {
  return json({ error: message }, status);
}

// بناء أساس الروابط من ترويسات الطلب الوارد (يحترم البروكسي/البوابة)
export function baseUrl(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("host") || "localhost:3030";
  return `${proto}://${host}`;
}
