import "server-only";
import nodemailer from "nodemailer";
import { smtpConfiguration } from "@/lib/email-config";
export function emailSender(input: Record<string, unknown> = process.env) {
  const { options, from } = smtpConfiguration(input);
  const transport = nodemailer.createTransport(options);
  return async (job: {
    id: string;
    recipient: string;
    subject: string;
    text: string;
  }) => {
    const result = await transport.sendMail({
      from,
      to: job.recipient,
      subject: job.subject,
      text: job.text,
      messageId: `<${job.id}@${from.split("@")[1]}>`,
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
