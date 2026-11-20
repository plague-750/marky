// تنزيل مصدر فيديو إلى ملف مع عدّ البايتات وفرض حد الحجم
import { ApiError } from "./http";
import { config, MB } from "./config";

interface DownloadOpts {
  url: string;
  dest: string;
  index: number; // رقم المصدر لأغراض رسائل الخطأ
  onProgress: (fraction: number) => void;
}

export async function downloadSource({ url, dest, index, onProgress }: DownloadOpts): Promise<number> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch {
    throw new ApiError(500, `فشل تحميل المصدر رقم ${index + 1} (تعذر الاتصال)`);
  }
  if (!res.ok || !res.body) {
    throw new ApiError(500, `فشل تحميل المصدر رقم ${index + 1} (HTTP ${res.status})`);
  }

  // فحص مبكر لحجم الملف المعلن إن وُجد
  const maxBytes = config.sourceMaxMB * MB;
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, "حجم أحد المصادر يتجاوز الحد المسموح");
  }

  const sink = Bun.file(dest).writer();
  let received = 0;
  let lastFlush = 0;
  try {
    for await (const chunk of res.body) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        throw new ApiError(413, "حجم أحد المصادر يتجاوز الحد المسموح");
      }
      sink.write(chunk);
      // تدفق دوري لتخفيف ضغط الذاكرة على الملفات الكبيرة
      if (received - lastFlush >= config.uploadChunkBytes) {
        sink.flush();
        lastFlush = received;
      }
      if (declared > 0) onProgress(Math.min(received / declared, 1));
    }
    await sink.end();
  } catch (e) {
    try {
      await sink.end();
    } catch {
      /* تجاهل */
    }
    throw e;
  }
  onProgress(1);
  return received;
}
