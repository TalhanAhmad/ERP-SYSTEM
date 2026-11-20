import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../access/policy";
import { financeReauthSchema } from "../access/schemas";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financePrivate } from "../ledger/http";
import { automationSchemas, type AutomationAction } from "./schemas";
import {
  automationCommand,
  recurringSchedules,
  recurringSchedule,
  recurringRuns,
  recurringRun,
  recognitions,
  recognition,
  preparationOptions,
  openingCreditReviews,
} from "./service";
import { processFinanceRecurring } from "./worker";
export async function automationRead(
  request: Request,
  mode:
    | "SCHEDULES"
    | "SCHEDULE"
    | "RUNS"
    | "RUN"
    | "RECOGNITIONS"
    | "RECOGNITION"
    | "OPTIONS"
    | "CREDIT_REVIEWS",
  id?: string,
) {
  try {
    requireFinanceEnabled();
    const a = await context(request.headers);
    await rateLimit("finance:automation:read:" + a.id);
    await financeStatus(a);
    const q = Object.fromEntries(new URL(request.url).searchParams);
    if (["RUN", "RECOGNITION"].includes(mode)) z.object({}).strict().parse(q);
    const data =
      mode === "SCHEDULES"
        ? await recurringSchedules(a, q)
        : mode === "SCHEDULE"
          ? await recurringSchedule(a, id, q)
          : mode === "RUNS"
            ? await recurringRuns(a, q)
            : mode === "RUN"
              ? await recurringRun(a, id)
              : mode === "RECOGNITIONS"
                ? await recognitions(a, q)
                : mode === "RECOGNITION"
                  ? await recognition(a, id)
                  : mode === "OPTIONS"
                    ? await preparationOptions(a, q)
                    : await openingCreditReviews(a, q);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function automationMutation(
  request: Request,
  action: AutomationAction,
  id?: string,
) {
  let finish = (r: NextResponse) => r;
  const requestId = crypto.randomUUID();
  try {
    requireFinanceEnabled();
    mutationOrigin(request);
    const a = await context(request.headers, { allowSecurity: true });
    await rateLimit("finance:reauth:" + a.id, 6);
    await financeStatus(a);
    const { reauth, ...body } = z
        .object({ reauth: financeReauthSchema })
        .passthrough()
        .parse(await jsonBody(request)),
      business = automationSchemas[action].parse(body),
      v = await verifyFinanceReauthentication(request, reauth);
    finish = v.finish;
    const data = await automationCommand(
      v.actor,
      v.proof,
      action,
      id,
      business,
      request.headers.get("Idempotency-Key"),
      requestId,
    );
    if (action === "PREPARE" || action === "RETRY")
      try {
        await processFinanceRecurring();
      } catch {
        /* Durable jobs remain visible and resumable. */
      }
    return financePrivate(
      finish(
        NextResponse.json(
          { data },
          {
            status: [
              "CREATE",
              "RECOGNITION_CREATE",
              "OPENING_CREDIT_REVIEW",
            ].includes(action)
              ? 201
              : 200,
          },
        ),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
