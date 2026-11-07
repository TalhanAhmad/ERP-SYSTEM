import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "./db";
import { env } from "./env";
function createLegacyAuth() {
  return betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await db.outbox.create({
          data: {
            eventKey: crypto.randomUUID(),
            recipient: user.email,
            subject: "Reset your Encova password",
            text: `Reset your password: ${url}`,
          },
        });
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "authRateLimit",
      window: 60,
      max: 30,
    },
    advanced: { database: { generateId: () => crypto.randomUUID() } },
  });
}
let instance: ReturnType<typeof createLegacyAuth> | undefined;
export function getLegacyAuth() {
  if (env.AUTH_PROVIDER !== "better-auth")
    throw new Error("Legacy auth is disabled in Supabase mode.");
  return (instance ??= createLegacyAuth());
}
