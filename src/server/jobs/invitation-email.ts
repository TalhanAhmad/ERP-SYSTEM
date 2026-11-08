import "server-only";
import { emailStatus } from "@/lib/email-config";
import { emailSender } from "./email";
import { processOutbox } from "./outbox";

// Called only after the authorized invitation mutation commits. A request
// sends at most its own invitation, never unrelated mail from the backlog.
export async function dispatchInvitationEmail(
  id: string,
  input: Record<string, unknown> = process.env,
  send?: Parameters<typeof processOutbox>[0],
) {
  if (!send && emailStatus(input) !== "READY") return;
  try {
    await processOutbox(send ?? emailSender(input), 1, id);
  } catch {
    // The durable queue survives provider/database failures. Do not turn a
    // committed invitation into an ambiguous failed browser mutation.
    console.error("INVITATION_EMAIL_DISPATCH_UNAVAILABLE");
  }
}
