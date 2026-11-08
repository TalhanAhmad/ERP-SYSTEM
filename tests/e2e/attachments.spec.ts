import { test, expect } from "@playwright/test";
import { login } from "./helpers";
test("validates uploads, reuses a retry key after a lost response and removes drafts", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(90000);
  await login(page, "e2e.admin@example.test");
  const people = (await (await page.request.get("/api/v1/users")).json()).data;
  const owner = people.find(
      (p: { username: string }) => p.username === "e2e.member",
    ),
    reviewer = people.find(
      (p: { username: string }) => p.username === "e2e.reviewer",
    );
  async function post(path: string, data: unknown) {
    const r = await page.request.post("/api/v1/" + path, {
      headers: {
        Origin: baseURL!,
        "X-Encova-CSRF": "1",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data,
    });
    expect(r.status()).toBe(200);
    return (await r.json()).data;
  }
  const project = await post("projects", {
    name: `Attachment browser ${Date.now()}`,
  });
  for (const id of [owner.id, reviewer.id])
    await post(`projects/${project.id}/members`, { userId: id });
  const task = await post("tasks", {
    projectId: project.id,
    assigneeId: owner.id,
    reviewerId: reviewer.id,
    title: "Retry attachment",
    description: "Synthetic",
  });
  const context = await browser.newContext();
  const member = await context.newPage();
  try {
    await login(member, "e2e.member@example.test");
    await member.goto(`/tasks/${task.id}`);
    await member
      .getByRole("button", { name: "Start task", exact: true })
      .click();
    const panel = member
      .locator("section.panel")
      .filter({
        has: member.getByRole("heading", { name: "Upload files", exact: true }),
      });
    await panel
      .getByLabel("Choose a file")
      .setInputFiles({
        name: "large.txt",
        mimeType: "text/plain",
        buffer: Buffer.alloc(4 * 1024 * 1024 + 1, 65),
      });
    await panel
      .getByRole("button", { name: "Upload file", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("up to 4 MB");
    await panel
      .getByLabel("Choose a file")
      .setInputFiles({
        name: "fake.png",
        mimeType: "image/png",
        buffer: Buffer.from("not an image"),
      });
    await panel
      .getByRole("button", { name: "Upload file", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText(
      "File contents do not match",
    );
    const keys: string[] = [];
    let drop = true;
    await member.route("**/api/v1/tasks/*/attachments", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      if (drop) {
        drop = false;
        await route.abort("failed");
      } else await route.fulfill({ response });
    });
    await panel
      .getByLabel("Choose a file")
      .setInputFiles({
        name: "retry.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Retry once without duplicate objects"),
      });
    await panel
      .getByRole("button", { name: "Upload file", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await panel
      .getByRole("button", { name: "Upload file", exact: true })
      .click();
    await expect(
      member.getByRole("checkbox", { name: /retry.txt/ }),
    ).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await panel
      .getByRole("button", { name: "Remove retry.txt", exact: true })
      .click();
    await expect(
      member.getByRole("checkbox", { name: /retry.txt/ }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
