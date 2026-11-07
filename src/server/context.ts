import "server-only";
import { headers } from "next/headers";
import { auth } from "./auth";
import { db } from "./db";
import { invariant } from "./errors";
export async function context(requestHeaders?: Headers) {
  const session = await auth.api.getSession({
    headers: requestHeaders ?? (await headers()),
  });
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
