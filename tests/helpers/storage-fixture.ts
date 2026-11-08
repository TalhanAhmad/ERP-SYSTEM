// Isolated loopback Storage protocol fixture; never an application storage fallback.
import http from "node:http";
export const STORAGE_FIXTURE_KEY = "synthetic-storage-server-key";
export async function startStorageFixture(port = 0) {
  const objects = new Map<string, { bytes: Buffer; mime: string }>();
  const state = { failAfterWrite: false, failRemove: false, downloads: 0 };
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url!, "http://fixture").pathname;
    if (path === "/health") {
      res.end("ok");
      return;
    }
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (req.headers.authorization !== `Bearer ${STORAGE_FIXTURE_KEY}`) {
      json(403, { message: "Denied", statusCode: "403" });
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
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
