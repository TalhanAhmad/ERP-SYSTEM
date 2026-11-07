import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("complete browser work lifecycle with three separate role sessions", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const adminContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const admin = await adminContext.newPage(),
    member = await memberContext.newPage(),
    reviewer = await reviewerContext.newPage();
  await login(admin, "e2e.admin@example.test");
  const projectName = `Browser project ${Date.now()}`;
  await admin.goto("/projects");
  await admin.getByText("Create a project", { exact: true }).click();
  await admin.getByLabel("Project name").fill(projectName);
  await admin
    .getByLabel("Description", { exact: true })
    .fill("Real browser fixture");
  await admin
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(admin.getByRole("heading", { name: projectName })).toBeVisible();
  const panel = admin.locator("section.panel").filter({ hasText: projectName });
  await panel.getByText("Add a project member").click();
  for (const username of ["e2e.member", "e2e.reviewer"]) {
    await panel
      .getByRole("combobox", { name: "Person", exact: true })
      .selectOption({ label: `@${username} · ${username}` });
    await panel
      .getByRole("button", { name: "Add member", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Add member", exact: true }),
    ).toBeEnabled();
  }
  await admin.goto("/tasks");
  await admin.getByText("Assign a task", { exact: true }).click();
  const title = `Browser task ${Date.now()}`;
  await admin.getByLabel("Task title").fill(title);
  await admin
    .getByLabel("Instructions")
    .fill("Submit a revision and get independent approval.");
  await admin
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption({ label: projectName });
  await admin
    .getByRole("combobox", { name: "Assignee", exact: true })
    .selectOption({ label: "e2e.member (@e2e.member)" });
  await admin
    .getByRole("combobox", { name: "Independent reviewer" })
    .selectOption({ label: "e2e.reviewer (@e2e.reviewer)" });
  await admin.getByRole("button", { name: "Assign task", exact: true }).click();
  await expect(
    admin.getByRole("link", { name: title, exact: true }),
  ).toBeVisible();
  await login(member, "e2e.member@example.test");
  await member.goto("/tasks");
  await member.getByRole("link", { name: title, exact: true }).click();
  await expect(member).toHaveURL(/\/tasks\/[0-9a-f-]+$/);
  const taskUrl = member.url();
  await member.getByRole("button", { name: "Start task", exact: true }).click();
  await expect(member.getByLabel("What did you complete?")).toBeVisible();
  await member
    .getByLabel("What did you complete?")
    .fill("Initial implementation");
  await member
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect(
    member.getByText("Your work is waiting for independent review."),
  ).toBeVisible();
  await login(reviewer, "e2e.reviewer@example.test");
  await reviewer.goto(taskUrl);
  await reviewer
    .getByRole("combobox", { name: "Decision" })
    .selectOption("REQUEST_CHANGES");
  await reviewer
    .getByLabel("Feedback", { exact: true })
    .fill("Please add boundary tests.");
  await reviewer
    .getByRole("button", { name: "Record review", exact: true })
    .click();
  await expect(reviewer.getByText("Please add boundary tests.")).toBeVisible();
  await member.reload();
  await member
    .getByLabel("What did you complete?")
    .fill("Added boundary tests.");
  await member
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect(
    member.getByText("Your work is waiting for independent review."),
  ).toBeVisible();
  await reviewer.reload();
  await reviewer
    .getByRole("combobox", { name: "Decision" })
    .selectOption("APPROVE");
  await reviewer.getByLabel("Feedback", { exact: true }).fill("Verified.");
  await reviewer
    .getByRole("button", { name: "Record review", exact: true })
    .click();
  await expect(
    reviewer.getByText("This assignment is approved."),
  ).toBeVisible();
  await expect(reviewer.getByText("Revision 1", { exact: true })).toBeVisible();
  await expect(reviewer.getByText("Revision 2", { exact: true })).toBeVisible();
  const outside = await browser.newPage();
  await login(outside, "e2e.outsider@example.test");
  await outside.goto(taskUrl);
  await expect(
    outside.getByRole("heading", { name: "Page not found." }),
  ).toBeVisible();
  await outside.close();
  await adminContext.close();
  await memberContext.close();
  await reviewerContext.close();
});
test("360-pixel login and workspace keep primary controls reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, "e2e.member@example.test");
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.getByRole("link", { name: "Go to my work" }).click();
  await expect(
    page.getByRole("heading", { name: "My work", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
});
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1280, height: 480 },
  { width: 360, height: 800 },
]) {
  test(`administrator can navigate and sign out at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await login(page, "e2e.admin@example.test");
    const navigation = page.getByRole("navigation", {
      name: "Main navigation",
    });
    await navigation
      .getByRole("link", { name: "Audit log", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Audit log", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
}
