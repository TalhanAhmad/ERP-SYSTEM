import { test, expect } from "@playwright/test";
import pg from "pg";
import { login } from "./helpers";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
test("structured table imports CSV, edits cells, previews atomic bulk changes, saves columns and exports filtered data", async ({
  page,
}) => {
  await login(page, "e2e.admin@example.test");
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const suffix = Date.now().toString(36),
    title = "Table browser " + suffix;
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post("/api/v1/" + path, {
      headers: {
        Origin: new URL(page.url()).origin,
        "X-Encova-CSRF": "1",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data,
    });
    expect(r.status(), await r.text()).toBe(200);
    return (await r.json()).data;
  };
  try {
    const people = (
      await sql.query(
        'SELECT id,username FROM "Person" WHERE email=ANY($1::text[])',
        [["e2e.member@example.test", "e2e.reviewer@example.test"]],
      )
    ).rows;
    const member = people.find((p) => p.username === "e2e.member"),
      reviewer = people.find((p) => p.username === "e2e.reviewer");
    const p = await post("projects", {
      name: "Table project " + suffix,
      description: "Browser verification",
    });
    for (const person of people)
      await post(`projects/${p.id}/members`, { userId: person.id });
    await page.goto("/tables?entity=tasks&project=" + p.id);
    await page
      .getByRole("combobox", { name: "Import project", exact: true })
      .selectOption(p.id);
    await page.getByLabel("Task CSV file").setInputFiles({
      name: "tasks.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `title,assignee,reviewer\n${title},${member.username},${reviewer.username}`,
      ),
    });
    await page
      .getByRole("button", { name: "Preview CSV import", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Ready to commit · 1 tasks" }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", {
        name: "I reviewed this preview and confirm all 1 tasks",
      })
      .check();
    await page
      .getByRole("button", { name: "Commit task import", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Imported 1 tasks." }),
    ).toBeVisible();
    const grid = page.getByRole("grid", { name: "Tasks structured table" }),
      row = grid.getByRole("row").filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByText("Edit priority", { exact: true }).click();
    await row.getByLabel("New priority").selectOption("HIGH");
    await row.getByRole("button", { name: "Save cell", exact: true }).click();
    await expect(
      row
        .locator("td")
        .filter({ has: page.locator("span").filter({ hasText: /^HIGH$/ }) }),
    ).toBeVisible();
    await row
      .getByRole("checkbox", { name: "Select " + title, exact: true })
      .check();
    await page
      .getByRole("combobox", { name: "Bulk priority", exact: true })
      .selectOption("URGENT");
    await page
      .getByLabel("Reason for bulk change")
      .fill("Browser priority update");
    await page
      .getByRole("button", { name: "Preview bulk changes", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Ready to commit · 1 tasks" }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", {
        name: "I reviewed this preview and confirm all 1 tasks",
      })
      .check();
    await page
      .getByRole("button", { name: "Commit bulk changes", exact: true })
      .click();
    await expect(
      row
        .locator("td")
        .filter({ has: page.locator("span").filter({ hasText: /^URGENT$/ }) }),
    ).toBeVisible();
    await page
      .getByText("Columns and personal saved views", { exact: true })
      .click();
    await page.getByRole("checkbox", { name: "Reviewer", exact: true }).check();
    await page.getByLabel("Personal view name").fill("Browser view " + suffix);
    await page
      .getByRole("button", { name: "Save personal view", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Browser view " + suffix, exact: true })
      .click();
    await expect(
      grid.getByRole("columnheader", { name: "Reviewer", exact: true }),
    ).toBeVisible();
    await expect(async () => {
      await grid.focus();
      await page.keyboard.press("ArrowDown");
      await expect(
        grid.locator("tbody tr").first().locator("td").first(),
      ).toBeFocused({ timeout: 500 });
    }).toPass({ timeout: 10000 });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page
        .getByRole("link", { name: "Export filtered CSV", exact: true })
        .click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= 360),
    ).toBe(true);
    const task = (
      await sql.query('SELECT id FROM "Task" WHERE "projectId"=$1', [p.id])
    ).rows[0];
    expect(
      (await sql.query('SELECT priority FROM "Task" WHERE id=$1', [task.id]))
        .rows[0].priority,
    ).toBe("URGENT");
  } finally {
    await sql.end();
  }
});
