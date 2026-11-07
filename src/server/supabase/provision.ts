import "server-only";
import { supabaseAdmin } from "./client";
import { invariant, AppError } from "@/server/errors";
export type ProvisionInput = {
  email: string;
  password: string;
  displayName: string;
  invitationId: string;
};
export type IdentityGateway = {
  provision: (input: ProvisionInput) => Promise<{ id: string }>;
};
export const supabaseIdentity: IdentityGateway = {
  async provision(input) {
    const admin = supabaseAdmin();
    const result = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.displayName },
      app_metadata: { encova_invitation_id: input.invitationId },
    });
    if (result.data.user && !result.error) return { id: result.data.user.id };
    // Recover a provider success followed by an ambiguous timeout/crash. Link only
    // identities bearing server-controlled provenance for this exact invitation.
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 100,
      });
      if (error)
        throw new AppError(
          "AUTH_UNAVAILABLE",
          "Account provisioning is temporarily unavailable.",
          503,
        );
      const matching = data.users.find(
        (user) => user.email?.toLowerCase() === input.email,
      );
      if (matching) {
        invariant(
          matching.app_metadata.encova_invitation_id === input.invitationId,
          "IDENTITY_CONFLICT",
          "This email requires administrator reconciliation.",
          409,
        );
        const updated = await admin.auth.admin.updateUserById(matching.id, {
          password: input.password,
          email_confirm: true,
        });
        invariant(
          !updated.error,
          "AUTH_UNAVAILABLE",
          "Account provisioning is temporarily unavailable.",
          503,
        );
        return { id: matching.id };
      }
      if (data.users.length < 100) break;
    }
    throw new AppError(
      "AUTH_UNAVAILABLE",
      "Account provisioning is temporarily unavailable.",
      503,
    );
  },
};
