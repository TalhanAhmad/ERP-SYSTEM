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
const { emailSender } = await import("@/server/jobs/email");
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
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as net.AddressInfo).port;
});
beforeEach(async () => {
  reject = false;
  messages.length = 0;
  await db.outbox.deleteMany();
});
afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
