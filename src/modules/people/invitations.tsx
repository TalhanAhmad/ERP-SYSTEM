import type { Actor } from "@/server/context";
import { listInvitations } from "@/modules/identity/service";
import { emailStatus, emailTestMode } from "@/lib/email-config";
import { InvitationAction } from "@/components/work-forms";
import { Status } from "@/components/status";
export async function InvitationsPanel({ actor }: { actor: Actor }) {
  const invitations = await listInvitations(actor);
  return (
    <section className="panel" aria-labelledby="invitations-heading">
      <h2 id="invitations-heading">Invitations</h2>
      {emailStatus() !== "READY" && (
        <p className="error" role="status">
          Email delivery is not configured. Invitations will remain queued until
          an email service is connected.
        </p>
      )}
      {emailTestMode() && (
        <p className="note" role="status">
          Email is in personal demo mode and can only reach the configured test
          inbox. Invitations to other people need a verified sending domain.
        </p>
      )}
      <p className="note">
        Sending or resending attempts email delivery when the service is
        configured. Resending replaces the previous link. Revoking prevents
        account creation. An email already being sent may still arrive, but its
        canceled link will not work.
      </p>
      {invitations.length === 0 ? (
        <p className="empty">No invitations yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Status</th>
                <th>Email</th>
                <th>Expires (Karachi)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.displayName}</strong>
                    <div>{item.email}</div>
                    <div className="muted">@{item.username}</div>
                  </td>
                  <td>{item.role.replaceAll("_", " ").toLowerCase()}</td>
                  <td>
                    <Status value={item.status} />
                    {item.processing && (
                      <p className="note">Account creation in progress</p>
                    )}
                  </td>
                  <td>
                    {
                      {
                        QUEUED: "Queued",
                        SMTP_ACCEPTED: "Accepted by email server",
                        CANCELED: "Canceled",
                        RETRYING: "Retrying",
                        FAILED: "Failed",
                      }[item.delivery]
                    }
                  </td>
                  <td>
                    {new Intl.DateTimeFormat("en-GB", {
                      timeZone: "Asia/Karachi",
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(item.expiresAt)}
                  </td>
                  <td>
                    {!["ACCEPTED", "REVOKED"].includes(item.status) && (
                      <div className="stack">
                        {!item.processing && (
                          <InvitationAction
                            id={item.id}
                            version={item.version}
                            action="resend"
                          />
                        )}
                        <InvitationAction
                          id={item.id}
                          version={item.version}
                          action="revoke"
                        />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
