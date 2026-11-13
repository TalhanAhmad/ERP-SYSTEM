import Link from "next/link";
import { env } from "@/server/env";
import { financePageData } from "../accounting/page-data";
import { files } from "../documents/files/service";
import type { sourceSchema } from "../documents/files/validation";
import type { z } from "zod";
import { EvidenceUpload, EvidenceActions } from "./evidence-files";
export async function EvidenceSection({
  sourceType,
  sourceId,
  state,
}: {
  sourceType: z.output<typeof sourceSchema>["sourceType"];
  sourceId: string;
  state: string;
}) {
  const data = await financePageData((a) =>
      files(a, { sourceType, sourceId, state: "ACTIVE" }),
    ),
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section className="panel" aria-label="Private financial evidence">
      <h2>Private evidence</h2>
      <Link
        href={
          "/finance/attachments?" +
          new URLSearchParams({ sourceType, sourceId })
        }
      >
        Evidence history
      </Link>
      {data.items.map((file) => (
        <section className="panel" key={file.id} aria-label={file.fileName}>
          <h3>{file.fileName}</h3>
          <p>
            {file.byteSize.toLocaleString("en-PK")} bytes ·{" "}
            {file.uploader.displayName}
          </p>
          <EvidenceActions
            file={file}
            hosted={hosted}
            canRemove={state === "DRAFT"}
          />
        </section>
      ))}
      {state !== "VOIDED" && (
        <EvidenceUpload
          sourceType={sourceType}
          sourceId={sourceId}
          hosted={hosted}
        />
      )}
    </section>
  );
}
