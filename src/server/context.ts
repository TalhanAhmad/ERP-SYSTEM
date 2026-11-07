import "server-only";
import { headers } from "next/headers";
import { getLegacyAuth } from "./auth";
import { db } from "./db";
import { env } from "./env";
import { invariant } from "./errors";
import { supabaseServer } from "./supabase/client";
export async function context(requestHeaders?: Headers) {
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
