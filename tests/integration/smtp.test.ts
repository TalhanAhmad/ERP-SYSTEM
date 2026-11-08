import "dotenv/config";
import net from "node:net";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
process.env.DATABASE_URL = url;
const { db } = await import("@/server/db");
const { processOutbox } = await import("@/server/jobs/outbox");
const { emailSender, verifyEmailTransport } =
  await import("@/server/jobs/email");
const { dispatchInvitationEmail } =
  await import("@/server/jobs/invitation-email");
const sockets = new Set<net.Socket>();
let reject = false;
const messages: string[] = [];
const server = net.createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.setEncoding("utf8");
  socket.write("220 synthetic.local ESMTP\r\n");
  let buffer = "",
    inData = false,
    body = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\r\n")) {
      const end = buffer.indexOf("\r\n"),
        line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (inData) {
        if (line === ".") {
          messages.push(body);
          body = "";
          inData = false;
          socket.write("250 queued locally\r\n");
        } else body += line + "\r\n";
        continue;
      }
      if (/^EHLO|^HELO/.test(line)) socket.write("250 synthetic.local\r\n");
      else if (/^MAIL FROM/.test(line)) socket.write("250 sender accepted\r\n");
      else if (/^RCPT TO/.test(line))
        socket.write(
          reject
            ? "550 synthetic recipient rejection\r\n"
            : "250 recipient accepted\r\n",
        );
      else if (line === "DATA") {
        inData = true;
        socket.write("354 end with dot\r\n");
      } else if (line === "QUIT") {
        socket.end("221 goodbye\r\n");
      } else socket.write("250 ok\r\n");
    }
  });
});
let port: number;
let inviter: Awaited<ReturnType<typeof db.person.create>>;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as net.AddressInfo).port;
  const suffix = crypto.randomUUID().slice(0, 8);
  inviter = await db.person.create({
    data: {
      email: `smtp.owner.${suffix}@example.test`,
      username: `smtp.owner.${suffix}`,
      displayName: "Synthetic SMTP owner",
      role: "SUPER_ADMIN",
      employmentType: "EMPLOYEE",
      status: "ACTIVE",
    },
  });
});
beforeEach(async () => {
  reject = false;
  messages.length = 0;
  await db.outbox.deleteMany();
});
afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.outbox.deleteMany({
    where: { invitation: { invitedBy: inviter.id } },
  });
  await db.invitation.deleteMany({ where: { invitedBy: inviter.id } });
  await db.person.update({
    where: { id: inviter.id },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
const job = () =>
  db.outbox.create({
    data: {
      eventKey: crypto.randomUUID(),
      recipient: "synthetic@example.test",
      subject: "Local SMTP acceptance",
      text: "Synthetic invitation content only",
    },
  });
const sender = () =>
  emailSender({
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: port,
    SMTP_FROM: "workspace@example.test",
  });
it("verifies the SMTP connection without sending a message", async () => {
  await verifyEmailTransport({
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: port,
    SMTP_FROM: "workspace@example.test",
  });
  expect(messages).toHaveLength(0);
});
it("keeps restricted demo mail away from other recipients before SMTP submission", async () => {
  const send = emailSender({
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: port,
    SMTP_FROM: "workspace@example.test",
    SMTP_TEST_RECIPIENT: "owner@example.test",
  });
  await expect(
    send({
      id: crypto.randomUUID(),
      recipient: "someone.else@example.test",
      subject: "Synthetic restriction check",
      text: "Fixture only",
    }),
  ).rejects.toThrow(
    "The demo sender can only email the configured test recipient.",
  );
  expect(messages).toHaveLength(0);
  await send({
    id: crypto.randomUUID(),
    recipient: "owner@example.test",
    subject: "Synthetic allowed recipient",
    text: "Fixture only",
  });
  expect(messages).toHaveLength(1);
});
it("redacts connection/authentication failures from verification", async () => {
  await expect(
    verifyEmailTransport({
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: 1,
      SMTP_FROM: "workspace@example.test",
      SMTP_USER: "private-user",
      SMTP_PASSWORD: "private-password",
    }),
  ).rejects.toThrow("SMTP connection or authentication failed.");
});
it("passes a real SMTP conversation before recording server acceptance", async () => {
  const record = await job();
  await processOutbox(sender(), 1);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("Synthetic invitation content only");
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: record.id } }))
      .deliveredAt,
  ).toBeTruthy();
});
it("dispatches only the selected committed invitation and preserves unrelated queued mail", async () => {
  const unrelated = await job();
  const invitation = await db.invitation.create({
    data: {
      email: `smtp.${crypto.randomUUID()}@example.test`,
      username: `smtp.${crypto.randomUUID().slice(0, 8)}`,
      displayName: "Synthetic SMTP invitation",
      role: "MEMBER",
      employmentType: "EMPLOYEE",
      invitedBy: inviter.id,
      tokenHash: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const record = await job();
  await db.outbox.update({
    where: { id: record.id },
    data: { invitationId: invitation.id },
  });
  await dispatchInvitationEmail(invitation.id, {}, sender());
  expect(messages).toHaveLength(1);
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: record.id } }))
      .deliveredAt,
  ).toBeTruthy();
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: unrelated.id } }))
      .attempts,
  ).toBe(0);
  await dispatchInvitationEmail(invitation.id, {}, sender());
  expect(messages).toHaveLength(1);
  await db.outbox.deleteMany({ where: { invitationId: invitation.id } });
  await db.invitation.delete({ where: { id: invitation.id } });
});
it("does not send expired invitations or attempt dispatch without configured SMTP", async () => {
  const record = await job();
  const invitation = await db.invitation.create({
    data: {
      email: `expired.${crypto.randomUUID()}@example.test`,
      username: `expired.${crypto.randomUUID().slice(0, 8)}`,
      displayName: "Expired SMTP invitation",
      role: "MEMBER",
      employmentType: "EMPLOYEE",
      invitedBy: inviter.id,
      tokenHash: crypto.randomUUID(),
      expiresAt: new Date(0),
    },
  });
  await db.outbox.update({
    where: { id: record.id },
    data: { invitationId: invitation.id },
  });
  await dispatchInvitationEmail(invitation.id, {}, sender());
  expect(messages).toHaveLength(0);
  await db.invitation.update({
    where: { id: invitation.id },
    data: { expiresAt: new Date(Date.now() + 3600000) },
  });
  await dispatchInvitationEmail(invitation.id, {});
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: record.id } })).attempts,
  ).toBe(0);
  await db.outbox.deleteMany({ where: { invitationId: invitation.id } });
  await db.invitation.delete({ where: { id: invitation.id } });
});
it("retains SMTP-rejected recipients for retry and never claims delivery", async () => {
  const record = await job();
  reject = true;
  await processOutbox(sender(), 1);
  const result = await db.outbox.findUniqueOrThrow({
    where: { id: record.id },
  });
  expect(messages).toHaveLength(0);
  expect(result.deliveredAt).toBeNull();
  expect(result.lastError).toBe("SMTP_DELIVERY_FAILED");
  expect(result.attempts).toBe(1);
  reject = false;
  await db.outbox.update({
    where: { id: record.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await processOutbox(sender(), 1);
  expect(messages).toHaveLength(1);
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: record.id } }))
      .deliveredAt,
  ).toBeTruthy();
});
it("sends through the real HTTP invitation mutation after commit and does not resend an idempotent replay", async () => {
  const { betterAuth } = await import("better-auth");
  const { prismaAdapter } = await import("better-auth/adapters/prisma");
  const auth = betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
  });
  const signedUp = await auth.api.signUpEmail({
    body: {
      email: inviter.email,
      name: inviter.displayName,
      password: "Synthetic-smtp-fixture-9#",
    },
    asResponse: true,
  });
  const user = await db.user.update({
    where: { email: inviter.email },
    data: { emailVerified: true },
  });
  await db.person.update({
    where: { id: inviter.id },
    data: { authUserId: user.id },
  });
  const keys = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_FROM",
    "SMTP_USER",
    "SMTP_PASSWORD",
  ];
  const saved = keys.map((key) => process.env[key]);
  Object.assign(process.env, {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(port),
    SMTP_FROM: "workspace@example.test",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
  });
  try {
    const { POST } = await import("@/app/api/v1/[...path]/route");
    const origin = process.env.APP_URL ?? process.env.BETTER_AUTH_URL!;
    const headers = {
      cookie: signedUp.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
      Origin: new URL(origin).origin,
      "Content-Type": "application/json",
      "X-Encova-CSRF": "1",
      "Idempotency-Key": crypto.randomUUID(),
    };
    const body = JSON.stringify({
      email: `http.smtp.${crypto.randomUUID()}@example.test`,
      username: `http.smtp.${crypto.randomUUID().slice(0, 8)}`,
      displayName: "HTTP SMTP fixture",
      role: "MEMBER",
      employmentType: "EMPLOYEE",
    });
    const invoke = () =>
      POST(
        new Request(`${origin}/api/v1/invitations`, {
          method: "POST",
          headers,
          body,
        }),
        { params: Promise.resolve({ path: ["invitations"] }) },
      );
    const result = await invoke();
    expect(result.status).toBe(200);
    expect(messages).toHaveLength(1);
    const { data } = await result.json();
    expect(
      (await db.outbox.findFirstOrThrow({ where: { invitationId: data.id } }))
        .deliveredAt,
    ).toBeTruthy();
    expect((await invoke()).status).toBe(200);
    expect(messages).toHaveLength(1);
    reject = true;
    const resend = await POST(
      new Request(`${origin}/api/v1/invitations/${data.id}/resend`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: 1 }),
      }),
      { params: Promise.resolve({ path: ["invitations", data.id, "resend"] }) },
    );
    expect(resend.status).toBe(200);
    const queued = await db.outbox.findFirstOrThrow({
      where: { invitationId: data.id, deliveredAt: null, canceledAt: null },
    });
    expect(queued.lastError).toBe("SMTP_DELIVERY_FAILED");
    expect(queued.attempts).toBe(1);
    expect(JSON.stringify(await resend.json())).not.toContain("/invite/");
  } finally {
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
  }
});
