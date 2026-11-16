import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../access/policy";
import { financeReauthSchema } from "../access/schemas";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financePrivate } from "../ledger/http";
import { projectSchemas, type ProjectFinanceAction } from "./schemas";
import {
  projectFinanceCommand,
  projectFinanceDetail,
  commercialProjects,
  commercialChildren,
  commercialChildDetail,
  projectFinanceOptions,
  milestoneLinkDetail,
} from "./service";
export async function commercialRead(
  request: Request,
  kind: "PROFILE" | "VARIATION" | "MILESTONE" | "OPTIONS" | "LINK",
  id?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:commercial:read:" + actor.id);
    const q = Object.fromEntries(new URL(request.url).searchParams);
    const data =
      kind === "OPTIONS"
        ? await projectFinanceOptions(actor, q)
        : kind === "LINK"
          ? await milestoneLinkDetail(actor, id ?? "")
          : kind === "PROFILE"
            ? id
              ? await projectFinanceDetail(actor, id)
              : await commercialProjects(actor, q)
            : id
              ? await commercialChildDetail(actor, kind, id, q)
              : await commercialChildren(actor, kind, q);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function commercialMutation(
  request: Request,
  action: ProjectFinanceAction,
  id?: string,
) {
  let finish = (r: NextResponse) => r;
  const requestId = crypto.randomUUID();
  try {
    requireFinanceEnabled();
    mutationOrigin(request);
    const actor = await context(request.headers, { allowSecurity: true });
    await rateLimit("finance:reauth:" + actor.id, 6);
    await financeStatus(actor);
    const { reauth, ...body } = z
        .object({ reauth: financeReauthSchema })
        .passthrough()
        .parse(await jsonBody(request)),
      business = projectSchemas[action].parse(body),
      verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await projectFinanceCommand(
      verified.actor,
      verified.proof,
      action,
      { ...business, ...(id ? { id: z.uuid().parse(id) } : {}) },
      request.headers.get("Idempotency-Key"),
      requestId,
    );
    return financePrivate(
      finish(
        NextResponse.json(
          { data },
          { status: action.endsWith("_CREATE") ? 201 : 200 },
        ),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
