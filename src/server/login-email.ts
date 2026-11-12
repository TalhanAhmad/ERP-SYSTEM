import "server-only";
import { z } from "zod";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Person } from "@/generated/prisma/client";
import { db } from "./db";
import { env } from "./env";
import { invariant } from "./errors";
import { audit, type Tx } from "./transaction";
import { emailStatus, emailTestMode } from "@/lib/email-config";
import { supabasePasswordClient } from "./supabase/client";
export const loginEmailSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.trim().toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
export function loginEmailAvailable() {
  return (
    env.AUTH_PROVIDER === "supabase" &&
    env.EMAIL_CHANGE_ENABLED &&
    emailStatus() === "READY" &&
    !emailTestMode()
  );
}
// Call only after the provider has verified this user and while holding Person's row lock.
export async function synchronizeLoginEmail(
  tx: Tx,
  person: Person,
  user: User,
  currentSessionId: string,
) {
  invariant(
    person.status === "ACTIVE" &&
      person.supabaseUserId === user.id &&
      user.email_confirmed_at,
    "UNAUTHENTICATED",
    "Please sign in again.",
    401,
  );
  const email = z.email().max(254).parse(user.email).trim().toLowerCase();
  if (person.email === email) return person;
  invariant(
    !user.new_email,
    "EMAIL_CONFIRMATION_PENDING",
    "Confirm both email addresses before continuing.",
    409,
  );
  const other = await tx.person.findFirst({
    where: { email, id: { not: person.id } },
    select: { id: true },
  });
  invariant(
    !other,
    "EMAIL_LINK_CONFLICT",
    "Your verified email needs administrator review. Your workspace records are preserved.",
    409,
  );
  // Only this verified self-service path may synchronize a selected finance
  // identity's email. The marker is transaction-local and never client supplied.
  await tx.$queryRaw`SELECT set_config('encova.finance_self_email', ${person.id}, true)`;
  const updated = await tx.person.update({
    where: { id: person.id },
    data: { email, version: { increment: 1 } },
  });
  const revoked = await tx.appSession.deleteMany({
    where: { userId: person.id, id: { not: currentSessionId } },
  });
  await audit(tx, person.id, "LOGIN_EMAIL_VERIFIED", person.id, {
    otherSessionsRevoked: revoked.count,
  });
  return updated;
}
export async function requestLoginEmail(
  actor: Person,
  client: SupabaseClient,
  user: User,
  input: z.infer<typeof loginEmailSchema>,
  recheck: () => Promise<Person>,
) {
  invariant(
    loginEmailAvailable(),
    "EMAIL_DELIVERY_REQUIRED",
    "Email delivery must be configured before login email changes are available.",
    409,
  );
  invariant(
    actor.supabaseUserId === user.id && user.email_confirmed_at,
    "UNAUTHENTICATED",
    "Please sign in again.",
    401,
  );
  invariant(
    input.email !== user.email?.toLowerCase(),
    "EMAIL_UNCHANGED",
    "Choose a different email address.",
    422,
  );
  const verifier = supabasePasswordClient();
  try {
    const result = await verifier.auth.signInWithPassword({
      email: user.email!,
      password: input.password,
    });
    invariant(
      !result.error && result.data.user?.id === user.id,
      "REAUTHENTICATION_FAILED",
      "Your current password could not be verified.",
      403,
    );
  } finally {
    await verifier.auth.signOut({ scope: "local" });
  }
  const current = await recheck();
  invariant(
    current.id === actor.id &&
      current.role === actor.role &&
      current.email === actor.email,
    "PERMISSIONS_CHANGED",
    "Permissions changed. Sign in and try again.",
    409,
  );
  invariant(
    !(await db.person.findFirst({
      where: { email: input.email, id: { not: actor.id } },
      select: { id: true },
    })),
    "EMAIL_UNAVAILABLE",
    "This email address cannot be used.",
    409,
  );
  const { error } = await client.auth.updateUser(
    { email: input.email },
    {
      emailRedirectTo:
        env.APP_URL + "/auth/confirm?next=/security&flow=email-change",
    },
  );
  invariant(
    !error,
    "EMAIL_CHANGE_FAILED",
    "Unable to request an email change. Check the address or try again later.",
    422,
  );
  await db.$transaction(async (tx) =>
    audit(tx, actor.id, "LOGIN_EMAIL_CHANGE_REQUESTED", actor.id),
  );
  // Never store passwords, confirmation tokens, provider sessions or new addresses in receipts/audits.
  return { pending: true };
}
