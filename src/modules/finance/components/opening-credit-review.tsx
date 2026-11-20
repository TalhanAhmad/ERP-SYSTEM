import { financePageData } from "../accounting/page-data";
import { openingCreditStatus } from "../automation/service";
import { OpeningCreditForm } from "./automation-forms";
import { env } from "@/server/env";
export async function OpeningCreditReview({
  side,
  id,
}: {
  side: "CUSTOMER" | "SUPPLIER";
  id: string;
}) {
  const d = await financePageData((a) => openingCreditStatus(a, side, id));
  if (!d.required) return null;
  return (
    <section className="panel">
      <h2>Opening credit classification review</h2>
      {d.review ? (
        <p>
          Owner-approved equity offset and exact draft proof retained.{" "}
          {d.review.evidence}
        </p>
      ) : (
        <p>
          Owner approval is required before this imported balance can be
          credited. Original opening clearing and current sales/costs stay
          unchanged.
        </p>
      )}
      {d.canManage && d.state === "DRAFT" && !d.review && (
        <OpeningCreditForm
          hosted={env.AUTH_PROVIDER === "supabase"}
          side={side}
          documentId={id}
          version={d.version}
        />
      )}
    </section>
  );
}
