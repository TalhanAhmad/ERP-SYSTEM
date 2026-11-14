import "server-only";
import { z } from "zod";
import { env } from "@/server/env";
export const scanResultSchema = z
  .object({
    status: z.enum(["CLEAN", "INFECTED"]),
    sha256: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    engine: z.string().trim().min(1).max(200),
    keyId: z.uuid(),
    signature: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type FinanceScanner = (
  bytes: Uint8Array,
  sha256: string,
  mime: string,
  fileId: string,
  challenge: string,
) => Promise<z.output<typeof scanResultSchema> | null>;
export const financeScanner: FinanceScanner = async (
  bytes,
  sha256,
  mime,
  fileId,
  challenge,
) => {
  if (!env.FINANCE_SCANNER_URL || !env.FINANCE_SCANNER_SECRET) return null;
  try {
    const r = await fetch(env.FINANCE_SCANNER_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.FINANCE_SCANNER_SECRET,
        "Content-Type": mime,
        "X-Content-SHA256": sha256,
        "X-Finance-File-Id": fileId,
        "X-Finance-Scan-Challenge": challenge,
      },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
      redirect: "error",
    });
    if (!r.ok || Number(r.headers.get("content-length") ?? 0) > 4096)
      return null;
    const text = await r.text();
    if (text.length > 4096) return null;
    const result = scanResultSchema.safeParse(JSON.parse(text));
    return result.success && result.data.sha256 === sha256 ? result.data : null;
  } catch {
    return null;
  }
};
