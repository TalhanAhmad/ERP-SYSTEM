import "server-only";
import nodemailer from "nodemailer";
import { z } from "zod";
export function emailSender() {
  const settings = z
    .object({
      SMTP_HOST: z.string().min(1),
      SMTP_PORT: z.coerce.number().int().positive(),
      SMTP_FROM: z.email(),
    })
    .parse(process.env);
  const transport = nodemailer.createTransport({
    host: settings.SMTP_HOST,
    port: settings.SMTP_PORT,
    secure: settings.SMTP_PORT === 465,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    ...(process.env.SMTP_USER
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          },
        }
      : {}),
  });
  return (job: {
    id: string;
    recipient: string;
    subject: string;
    text: string;
  }) =>
    transport.sendMail({
      from: settings.SMTP_FROM,
      to: job.recipient,
      subject: job.subject,
      text: job.text,
      messageId: `<${job.id}@encova-workspace.local>`,
    });
}
