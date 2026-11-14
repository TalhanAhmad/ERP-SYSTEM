// Isolated loopback Storage protocol fixture; never an application storage fallback.
import http from "node:http";
import { createHash, createHmac } from "node:crypto";
export const FINANCE_SCAN_FIXTURE_ID = "94d4ac58-2306-4ac9-a511-b839b47140dd";
export const FINANCE_SCAN_FIXTURE_SECRET =
  "Synthetic-file-scan-secret-only-32-characters";
export const FINANCE_SCAN_FIXTURE_BEARER =
  "Synthetic-scanner-bearer-only-32-characters";
export const STORAGE_FIXTURE_KEY = "synthetic-storage-server-key";
export async function startStorageFixture(port = 0) {
  const objects = new Map<string, { bytes: Buffer; mime: string }>();
  const uploadTokens = new Map<string, string>();
  const state = {
    scannerMode: "CLEAN" as "CLEAN" | "INFECTED" | "UNAVAILABLE",
    failAfterWrite: false,
    failRemove: false,
    downloads: 0,
  };
  const server = http.createServer(async (req, res) => {
    const requested = new URL(req.url!, "http://fixture"),
      path = requested.pathname;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,DELETE,OPTIONS",
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (path === "/health") {
      res.end("ok");
      return;
    }
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const signedPrefix = "/storage/v1/object/upload/sign/",
      signedName = path.startsWith(signedPrefix)
        ? path.slice(signedPrefix.length)
        : null;
    const signedWrite =
      req.method === "PUT" &&
      signedName &&
      uploadTokens.get(requested.searchParams.get("token") ?? "") ===
        signedName;
    const scannerRequest =
      path === "/finance-scan" &&
      req.headers.authorization === `Bearer ${FINANCE_SCAN_FIXTURE_BEARER}`;
    if (
      !signedWrite &&
      !scannerRequest &&
      req.headers.authorization !== `Bearer ${STORAGE_FIXTURE_KEY}`
    ) {
      json(403, { message: "Denied", statusCode: "403" });
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    if (scannerRequest) {
      if (state.scannerMode === "UNAVAILABLE") {
        json(503, { message: "Synthetic scanner unavailable" });
        return;
      }
      const sha256 = createHash("sha256").update(body).digest("hex"),
        fileId = String(req.headers["x-finance-file-id"]),
        challenge = String(req.headers["x-finance-scan-challenge"]),
        engine = "Synthetic browser scanner 1.0",
        status = state.scannerMode,
        message = [
          fileId,
          sha256,
          String(body.length),
          status,
          String(Buffer.byteLength(engine)),
          engine,
          challenge,
        ].join(":");
      json(200, {
        status,
        sha256,
        engine,
        keyId: FINANCE_SCAN_FIXTURE_ID,
        signature: createHmac("sha256", FINANCE_SCAN_FIXTURE_SECRET)
          .update(message)
          .digest("hex"),
      });
      return;
    }
    if (signedName && req.method === "POST") {
      const token = crypto.randomUUID();
      uploadTokens.set(token, signedName);
      json(200, {
        url: "/object/upload/sign/" + signedName + "?token=" + token,
      });
      return;
    }
    if (signedWrite) {
      if (objects.has(signedName!)) {
        json(409, { message: "Duplicate" });
        return;
      }
      if (body.length > 10 * 1024 * 1024) {
        json(413, { message: "Too large" });
        return;
      }
      objects.set(signedName!, {
        bytes: body,
        mime: String(req.headers["content-type"]),
      });
      json(200, { Key: signedName });
      return;
    }
    const prefix = "/storage/v1/object/";
    if (!path.startsWith(prefix)) {
      json(404, { message: "Not found" });
      return;
    }
    const name = path.slice(prefix.length).replace(/^authenticated\//, "");
    if (req.method === "POST") {
      if (objects.has(name)) {
        json(409, {
          statusCode: "409",
          error: "Duplicate",
          message: "The resource already exists",
        });
        return;
      }
      objects.set(name, {
        bytes: body,
        mime: String(req.headers["content-type"]),
      });
      if (state.failAfterWrite) {
        state.failAfterWrite = false;
        json(500, { statusCode: "500", message: "Ambiguous fixture write" });
        return;
      }
      json(200, { Key: name, Id: crypto.randomUUID() });
      return;
    }
    if (req.method === "GET") {
      state.downloads++;
      const item = objects.get(name);
      if (!item) {
        json(404, { statusCode: "404", message: "Not found" });
        return;
      }
      res.writeHead(200, { "Content-Type": item.mime });
      res.end(item.bytes);
      return;
    }
    if (req.method === "DELETE") {
      if (state.failRemove) {
        json(503, { statusCode: "503", message: "Synthetic remove failure" });
        return;
      }
      const { prefixes } = JSON.parse(body.toString());
      for (const key of prefixes) objects.delete(`${name}/${key}`);
      json(200, []);
      return;
    }
    json(405, { message: "Unsupported" });
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  return {
    url: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`,
    objects,
    state,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
