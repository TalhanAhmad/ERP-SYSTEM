import "server-only";
import type { NextResponse } from "next/server";
import { context } from "@/server/context";
import { getLegacyAuth } from "@/server/auth";
import { env } from "@/server/env";
import { invariant } from "@/server/errors";
import { cookieSession } from "@/server/identity-http";
import { supabasePasswordClient } from "@/server/supabase/client";
import { verifiedSessionClaims } from "@/server/security-session";
import { financeReauthSchema } from "./schemas";
import { requireFinanceEnabled } from "./policy";

declare const proofBrand: unique symbol;
export type FinanceProof = { readonly [proofBrand]: true };
type Evidence = {
  actorId: string;
  provider: "supabase" | "better-auth";
  sessionId: string;
  verifiedAt: Date;
  usedFor?: string;
};
// Only successful provider verification can mint this process-local capability.
// It cannot be constructed from JSON, a client timestamp, role or boolean flag.
const proofs = new WeakMap<FinanceProof, Evidence>();
export function consumeFinanceProof(
  proof: FinanceProof,
  actorId: string,
  operation: string,
) {
  const evidence = proofs.get(proof);
  invariant(
    evidence &&
      evidence.actorId === actorId &&
      Date.now() - evidence.verifiedAt.getTime() < 300000 &&
      Date.now() >= evidence.verifiedAt.getTime() &&
      (!evidence.usedFor || evidence.usedFor === operation),
    "FINANCE_REAUTH_REQUIRED",
    "Verify your password and authenticator again.",
    403,
  );
  evidence.usedFor = operation;
  return evidence;
}

export async function verifyFinanceReauthentication(
  request: Request,
  input: unknown,
) {
  requireFinanceEnabled();
  const credentials = financeReauthSchema.parse(input);
  const actor = await context(request.headers, { allowSecurity: true });
  invariant(
    actor.role === "SUPER_ADMIN",
    "FINANCE_FORBIDDEN",
    "Finance access is unavailable.",
    403,
  );
  let sessionId: string;
  let finish = (response: NextResponse) => response;
  if (env.AUTH_PROVIDER === "supabase") {
    const session = cookieSession(request);
    finish = session.finish;
    const verified = await session.client.auth.getUser();
    invariant(
      !verified.error &&
        verified.data.user?.id === actor.supabaseUserId &&
        verified.data.user.email_confirmed_at,
      "UNAUTHENTICATED",
      "Please sign in again.",
      401,
    );
    const verifier = supabasePasswordClient();
    try {
      const checked = await verifier.auth.signInWithPassword({
        email: verified.data.user.email!,
        password: credentials.password,
      });
      invariant(
        !checked.error && checked.data.user?.id === actor.supabaseUserId,
        "FINANCE_REAUTH_REQUIRED",
        "Your password could not be verified.",
        403,
      );
    } finally {
      await verifier.auth.signOut({ scope: "local" });
    }
    const factor = verified.data.user.factors?.find(
      (f) => f.factor_type === "totp" && f.status === "verified",
    );
    invariant(
      factor && credentials.code,
      "FINANCE_MFA_REQUIRED",
      "Set up your authenticator in Account security, then provide a fresh code.",
      403,
    );
    const challenge = await session.client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: credentials.code,
    });
    const aal = await session.client.auth.mfa.getAuthenticatorAssuranceLevel();
    invariant(
      !challenge.error && !aal.error && aal.data.currentLevel === "aal2",
      "FINANCE_MFA_REQUIRED",
      "Your authenticator code could not be verified.",
      403,
    );
    const current = await session.client.auth.getSession();
    invariant(
      current.data.session,
      "UNAUTHENTICATED",
      "Please sign in again.",
      401,
    );
    const claims = verifiedSessionClaims(current.data.session.access_token);
    invariant(
      claims.userId === actor.supabaseUserId,
      "UNAUTHENTICATED",
      "Please sign in again.",
      401,
    );
    sessionId = claims.sessionId;
  } else {
    const loopback = (url: string) =>
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
    invariant(
      !env.VERCEL_ENV && loopback(env.APP_URL) && loopback(env.DATABASE_URL),
      "FINANCE_MFA_REQUIRED",
      "Hosted finance access changes require Supabase and an authenticator.",
      403,
    );
    const auth = getLegacyAuth();
    const verified = await auth.api.verifyPassword({
      headers: request.headers,
      body: { password: credentials.password },
      asResponse: true,
    });
    invariant(
      verified.ok,
      "FINANCE_REAUTH_REQUIRED",
      "Your password could not be verified.",
      403,
    );
    const current = await auth.api.getSession({ headers: request.headers });
    invariant(
      current?.user.id === actor.authUserId,
      "UNAUTHENTICATED",
      "Please sign in again.",
      401,
    );
    sessionId = current.session.id;
  }
  const proof = Object.freeze({}) as FinanceProof;
  proofs.set(proof, {
    actorId: actor.id,
    provider: env.AUTH_PROVIDER,
    sessionId,
    verifiedAt: new Date(),
  });
  return { actor, proof, finish };
}
