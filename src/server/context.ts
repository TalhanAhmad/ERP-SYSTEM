import "server-only";
import { synchronizeLoginEmail } from "./login-email";
import { verifiedSessionClaims, assertMfa } from "./security-session";
import { headers } from "next/headers";
import { getLegacyAuth } from "./auth";
import { db } from "./db";
import { env } from "./env";
import { invariant } from "./errors";
import { supabaseServer } from "./supabase/client";
export async function context(
  requestHeaders?: Headers,
  options: { allowSecurity?: boolean } = {},
) {
  const incoming = requestHeaders ?? (await headers());
  if (env.AUTH_PROVIDER === "supabase") {
    const client = await supabaseServer(incoming);
    // getUser verifies the session with Supabase; unverified cookie contents never grant access.
    const { data, error } = await client.auth.getUser();
    invariant(
      !error && data.user?.email_confirmed_at,
      "UNAUTHENTICATED",
      "Please sign in.",
      401,
    );
    const person = await db.person.findUnique({
      where: { supabaseUserId: data.user.id },
    });
    invariant(
      person?.status === "ACTIVE",
      "ACCOUNT_INACTIVE",
      "This account is not active.",
      403,
    );
    const session = await client.auth.getSession();
    invariant(session.data.session, "UNAUTHENTICATED", "Please sign in.", 401);
    const { sessionId } = verifiedSessionClaims(
      session.data.session.access_token,
    );
    const registered = await db.appSession.findFirst({
      where: { id: sessionId, userId: person.id },
    });
    invariant(registered, "UNAUTHENTICATED", "Please sign in again.", 401);
    if (!options.allowSecurity) await assertMfa(client, person, data.user);
    if (person.email !== data.user.email?.toLowerCase()) {
      const updated = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${person.id}::uuid FOR UPDATE`;
        const current = await tx.person.findUniqueOrThrow({
          where: { id: person.id },
        });
        invariant(
          await tx.appSession.findFirst({
            where: { id: sessionId, userId: current.id },
          }),
          "UNAUTHENTICATED",
          "Please sign in again.",
          401,
        );
        return synchronizeLoginEmail(tx, current, data.user, sessionId);
      });
      if (!options.allowSecurity) await assertMfa(client, updated, data.user);
      return updated;
    }
    return person;
  }
  const session = await getLegacyAuth().api.getSession({ headers: incoming });
  invariant(session, "UNAUTHENTICATED", "Please sign in.", 401);
  const person = await db.person.findUnique({
    where: { authUserId: session.user.id },
  });
  invariant(
    person?.status === "ACTIVE",
    "ACCOUNT_INACTIVE",
    "This account is not active.",
    403,
  );
  return person;
}
export type Actor = Awaited<ReturnType<typeof context>>;
