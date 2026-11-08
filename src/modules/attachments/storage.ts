import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/server/supabase/client";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
export type FileStorage = {
  put: (key: string, body: Uint8Array, mime: string) => Promise<void>;
  get: (key: string) => Promise<Uint8Array>;
  remove: (key: string) => Promise<void>;
};
export const fileDigest = (body: Uint8Array) =>
  createHash("sha256").update(body).digest("hex");
export function storageAvailable() {
  return Boolean(
    env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_SECRET_KEY,
  );
}
const unavailable = () =>
  new AppError(
    "STORAGE_UNAVAILABLE",
    "File storage is temporarily unavailable. Retry shortly.",
    503,
  );
function bucket() {
  if (!storageAvailable()) throw unavailable();
  return supabaseAdmin((input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
  ).storage.from(env.SUPABASE_STORAGE_BUCKET);
}
export const fileStorage: FileStorage = {
  async put(key, body, mime) {
    try {
      const result = await bucket().upload(key, Buffer.from(body), {
        contentType: mime,
        upsert: false,
        cacheControl: "0",
      });
      if (!result.error) return;
      // A timeout may follow a successful write. Recover only the identical object;
      // never overwrite bytes belonging to an existing reservation.
      const existing = await this.get(key);
      if (fileDigest(existing) === fileDigest(body)) return;
    } catch {}
    throw unavailable();
  },
  async get(key) {
    try {
      const result = await bucket().download(key, {}, { cache: "no-store" });
      if (!result.error && result.data)
        return new Uint8Array(await result.data.arrayBuffer());
    } catch {}
    throw unavailable();
  },
  async remove(key) {
    try {
      const result = await bucket().remove([key]);
      if (!result.error) return;
    } catch {}
    throw unavailable();
  },
};
