import "server-only";
import nodemailer from "nodemailer";
import { smtpConfiguration } from "@/lib/email-config";
export async function verifyEmailTransport(
  input: Record<string, unknown> = process.env,
) {
  const { options } = smtpConfiguration(input);
  const transport = nodemailer.createTransport(options);
  try {
    await transport.verify();
  } catch {
    throw new Error("SMTP connection or authentication failed.");
  } finally {
    transport.close();
  }
}
export function emailSender(input: Record<string, unknown> = process.env) {
  const { options, from, testRecipient } = smtpConfiguration(input);
  const transport = nodemailer.createTransport(options);
  return async (job: {
    id: string;
    recipient: string;
    subject: string;
    text: string;
  }) => {
    if (
      testRecipient &&
      job.recipient.toLowerCase() !== testRecipient.toLowerCase()
    )
      throw new Error(
        "The demo sender can only email the configured test recipient.",
      );
    const result = await transport.sendMail({
      from,
      to: job.recipient,
      subject: job.subject,
      text: job.text,
      messageId: `<${job.id}@${from.split("@")[1]}>`,
      ...(options.host?.toLowerCase() === "smtp.resend.com"
        ? { headers: { "Resend-Idempotency-Key": `encova-outbox/${job.id}` } }
        : {}),
    });
    if (
      !result.accepted.some(
        (recipient) =>
          String(recipient).toLowerCase() === job.recipient.toLowerCase(),
      )
    )
      throw new Error("SMTP did not accept the recipient.");
    return result;
  };
}
