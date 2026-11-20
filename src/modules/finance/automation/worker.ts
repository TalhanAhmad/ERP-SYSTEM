import "server-only";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireFinanceEnabled } from "../access/policy";
export async function processRecurringRun(id: string) {
  requireFinanceEnabled();
  const claim = (
    await db.$queryRaw<
      { data: { id: string; leaseId: string } | null }[]
    >`SELECT public.encova_finance_automation_claim(${id}::uuid) AS data`
  )[0].data;
  if (!claim) return;
  // Finish locks/rechecks current owner, exact original grant epoch, schedule and live lease.
  // Trusted SQL prepares only normal reviewable drafts; it cannot choose POST through this worker.
  await db.$queryRaw`SELECT public.encova_finance_automation_finish(${claim.id}::uuid,${claim.leaseId}::uuid)::text`;
}
export async function processFinanceRecurring(deadline = Date.now() + 25000) {
  if (!env.FINANCE_ENABLED) return;
  await db.$queryRaw`SELECT public.encova_finance_automation_enqueue()`;
  const jobs = await db.$queryRaw<
    { id: string }[]
  >`SELECT public.encova_finance_automation_candidates() AS id`;
  for (const { id } of jobs) {
    if (Date.now() >= deadline - 5000) break;
    try {
      await processRecurringRun(id);
    } catch {
      /* Private durable lease resumes in a later bounded pass. No financial payload reaches ERP operations. */
    }
  }
}
