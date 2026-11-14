import "server-only";
import { supabaseAdmin } from "@/server/supabase/client";
import { AppError } from "@/server/errors";
import {
  storageAvailable,
  type FileStorage,
} from "@/modules/attachments/storage";
export const FINANCE_BUCKET = "encova-finance-evidence";
export type FinanceStorage = FileStorage & {
  signedUpload: (key: string) => Promise<string>;
};
const unavailable = () =>
  new AppError(
    "FINANCE_STORAGE_UNAVAILABLE",
    "Private evidence storage is temporarily unavailable.",
    503,
  );
function bucket() {
  if (!storageAvailable()) throw unavailable();
  return supabaseAdmin((input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
  ).storage.from(FINANCE_BUCKET);
}
export const financeStorage: FinanceStorage = {
  async signedUpload(key) {
    try {
      const r = await bucket().createSignedUploadUrl(key, { upsert: false });
      if (!r.error && r.data) return r.data.signedUrl;
    } catch {}
    throw unavailable();
  },
  async put(key, body, mime) {
    try {
      const r = await bucket().upload(key, Buffer.from(body), {
        upsert: false,
        contentType: mime,
        cacheControl: "0",
      });
      if (!r.error) return;
    } catch {}
    throw unavailable();
  },
  async get(key) {
    try {
      const r = await bucket().download(key, {}, { cache: "no-store" });
      if (!r.error && r.data) return new Uint8Array(await r.data.arrayBuffer());
    } catch {}
    throw unavailable();
  },
  async remove(key) {
    try {
      const r = await bucket().remove([key]);
      if (!r.error) return;
    } catch {}
    throw unavailable();
  },
};
