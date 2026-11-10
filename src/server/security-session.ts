import "server-only";
import { z } from "zod";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { db } from "./db";
import { invariant } from "./errors";
// Read claims only after getUser()/successful provider sign-in has verified this same token.
export function verifiedSessionClaims(token: string) {
  let value: unknown;
  try {
    value = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
  } catch {
    value = null;
  }
  const parsed = z
    .object({ session_id: z.uuid(), sub: z.uuid() })
    .safeParse(value);
  invariant(parsed.success, "UNAUTHENTICATED", "Please sign in again.", 401);
  return { sessionId: parsed.data.session_id, userId: parsed.data.sub };
}
export async function registerAppSession(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  invariant(
    !error && data.user?.email_confirmed_at,
    "UNAUTHENTICATED",
    "Please sign in.",
    401,
  );
  const { data: session } = await client.auth.getSession();
  invariant(session.session, "UNAUTHENTICATED", "Please sign in.", 401);
  const { sessionId, userId } = verifiedSessionClaims(
    session.session.access_token,
  );
  invariant(userId === data.user.id, "UNAUTHENTICATED", "Please sign in.", 401);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Person" WHERE "supabaseUserId"=${userId}::uuid FOR UPDATE`;
    const person = await tx.person.findUnique({
      where: { supabaseUserId: userId },
    });
    invariant(
      person?.status === "ACTIVE",
      "ACCOUNT_INACTIVE",
      "This account is not active.",
      403,
    );
    await tx.appSession.upsert({
      where: { id: sessionId },
      create: { id: sessionId, userId: person.id },
      update: {},
    });
    return person;
  });
}
export async function assertMfa(
  client: SupabaseClient,
  person: { role: string },
  user: User,
) {
  const policy = await db.companySettings.findUniqueOrThrow({
    where: { id: "workspace" },
  });
  const enrolled = (user.factors ?? []).some((f) => f.status === "verified");
  if (enrolled || (policy.requirePrivilegedMfa && person.role !== "MEMBER")) {
    const { data, error } =
      await client.auth.mfa.getAuthenticatorAssuranceLevel();
    invariant(
      !error && enrolled && data?.currentLevel === "aal2",
      "MFA_REQUIRED",
      "Verify your authenticator to continue.",
      403,
    );
  }
}
