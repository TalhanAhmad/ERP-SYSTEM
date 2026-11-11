import "server-only";
import { loginEmailSchema, requestLoginEmail } from "./login-email";
import { NextResponse } from "next/server";
import { z } from "zod";
import { context } from "./context";
import { env } from "./env";
import { db } from "./db";
import { cookieSession } from "./identity-http";
import { failure, jsonBody, mutationOrigin, rateLimit } from "./http";
import { invariant } from "./errors";
import { audit, expected } from "./transaction";
const actionSchema = z.discriminatedUnion("action", [
  loginEmailSchema.extend({ action: z.literal("email-change") }).strict(),
  z.object({ action: z.literal("enroll") }).strict(),
  z
    .object({
      action: z.literal("verify"),
      factorId: z.uuid(),
      code: z.string().regex(/^\d{6}$/),
    })
    .strict(),
  z.object({ action: z.literal("remove"), factorId: z.uuid() }).strict(),
  z.object({ action: z.literal("sign-out-all") }).strict(),
  z
    .object({
      action: z.literal("policy"),
      expectedVersion: z.number().int().positive(),
      required: z.boolean(),
    })
    .strict(),
]);
export async function securityAction(request: Request) {
  const requestId = crypto.randomUUID();
  let finish = (r: NextResponse) => r;
  try {
    mutationOrigin(request);
    const input = actionSchema.parse(await jsonBody(request));
    const actor = await context(request.headers, { allowSecurity: true });
    await rateLimit("security:" + actor.id, 10);
    invariant(
      env.AUTH_PROVIDER === "supabase",
      "PROVIDER_REQUIRED",
      "Authenticator settings use the hosted sign-in provider.",
      409,
    );
    const session = cookieSession(request);
    finish = session.finish;
    const { data: user, error: userError } =
      await session.client.auth.getUser();
    invariant(
      !userError && user.user,
      "UNAUTHENTICATED",
      "Please sign in.",
      401,
    );
    const factors = user.user.factors ?? [],
      { data: aal, error: aalError } =
        await session.client.auth.mfa.getAuthenticatorAssuranceLevel();
    invariant(
      !aalError,
      "AUTH_UNAVAILABLE",
      "Unable to verify account security.",
      503,
    );
    if (input.action === "email-change") {
      // Unlike enrollment/challenge, an email mutation requires full current MFA access.
      await context(request.headers);
      await rateLimit("email-change:" + actor.id, 3);
      const result = await requestLoginEmail(
        actor,
        session.client,
        user.user,
        input,
        () => context(request.headers),
      );
      return finish(NextResponse.json({ data: result }));
    } else if (input.action === "verify") {
      invariant(
        factors.some(
          (f) => f.id === input.factorId && f.factor_type === "totp",
        ),
        "NOT_FOUND",
        "Authenticator not found.",
        404,
      );
      const { error } = await session.client.auth.mfa.challengeAndVerify({
        factorId: input.factorId,
        code: input.code,
      });
      invariant(
        !error,
        "INVALID_CODE",
        "Authenticator code is invalid or expired.",
        422,
      );
      await db.$transaction(async (tx) =>
        audit(tx, actor.id, "MFA_VERIFIED", actor.id),
      );
    } else if (input.action === "sign-out-all") {
      await db.$transaction(async (tx) => {
        await tx.appSession.deleteMany({ where: { userId: actor.id } });
        await audit(tx, actor.id, "SESSIONS_REVOKED", actor.id);
      });
      const { error } = await session.client.auth.signOut({ scope: "global" });
      // App access is already revoked even if the provider cannot clear refresh tokens.
      invariant(
        !error,
        "PROVIDER_SIGNOUT_PENDING",
        "Workspace sessions are revoked. Provider sign-out could not complete; sign in again.",
        503,
      );
    } else if (input.action === "policy") {
      invariant(
        actor.role === "SUPER_ADMIN" &&
          aal?.currentLevel === "aal2" &&
          factors.some((f) => f.status === "verified"),
        "FORBIDDEN",
        "Verify a Super Admin authenticator before changing this policy.",
        403,
      );
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${actor.id}::uuid FOR UPDATE`;
        const current = await tx.person.findUniqueOrThrow({
          where: { id: actor.id },
        });
        invariant(
          current.role === "SUPER_ADMIN" && current.status === "ACTIVE",
          "FORBIDDEN",
          "Super Admin required.",
          403,
        );
        await tx.$queryRaw`SELECT id FROM "CompanySettings" WHERE id='workspace' FOR UPDATE`;
        const settings = await tx.companySettings.findUniqueOrThrow({
          where: { id: "workspace" },
        });
        expected(settings.version, input.expectedVersion);
        await tx.companySettings.update({
          where: { id: "workspace" },
          data: {
            requirePrivilegedMfa: input.required,
            version: { increment: 1 },
          },
        });
        await audit(tx, actor.id, "MFA_POLICY_UPDATED", "workspace", {
          required: input.required,
        });
      });
    } else {
      invariant(
        !factors.some((f) => f.status === "verified") ||
          aal?.currentLevel === "aal2",
        "MFA_REQUIRED",
        "Verify your existing authenticator first.",
        403,
      );
      if (input.action === "enroll") {
        invariant(
          !factors.some((f) => f.factor_type === "totp"),
          "FACTOR_EXISTS",
          "Remove or verify your existing authenticator first.",
          409,
        );
        const { data, error } = await session.client.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Encova authenticator",
          issuer: "Encova Workspace",
        });
        invariant(
          !error && data,
          "AUTH_UNAVAILABLE",
          "Unable to enroll an authenticator.",
          503,
        );
        return finish(
          NextResponse.json({
            data: {
              id: data.id,
              secret: data.totp.secret,
              qrCode: data.totp.qr_code,
            },
          }),
        );
      }
      invariant(
        factors.some((f) => f.id === input.factorId),
        "NOT_FOUND",
        "Authenticator not found.",
        404,
      );
      const { error } = await session.client.auth.mfa.unenroll({
        factorId: input.factorId,
      });
      invariant(
        !error,
        "AUTH_UNAVAILABLE",
        "Unable to remove authenticator.",
        503,
      );
      await db.$transaction(async (tx) =>
        audit(tx, actor.id, "MFA_REMOVED", actor.id),
      );
    }
    return finish(NextResponse.json({ data: { success: true } }));
  } catch (e) {
    return finish(failure(e, requestId));
  }
}
