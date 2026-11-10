import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login } from "./helpers";
test("core screens satisfy automated WCAG A/AA checks and production script nonces", async ({
  page,
}, testInfo) => {
  const findings: unknown[] = [];
  await page.goto("/login");
  const response = await page.request.get("/login");
  const csp = response.headers()["content-security-policy"];
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain("'unsafe-eval'");
  const next = await page.request.get("/login");
  expect(next.headers()["content-security-policy"]).not.toBe(csp);
  await page.getByRole("button", { name: "Sign in to workspace" }).waitFor();
  let scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  findings.push(
    ...scan.violations.map((v) => ({
      page: "login",
      rule: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  );
  await login(page, "e2e.admin@example.test");
  for (const path of [
    "/dashboard",
    "/tables?entity=tasks",
    "/attendance",
    "/security",
  ]) {
    await page.goto(path);
    await page.getByRole("heading", { level: 1 }).waitFor();
    scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    findings.push(
      ...scan.violations.map((v) => ({
        page: path,
        rule: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    );
  }
  await testInfo.attach("accessibility-findings", {
    body: JSON.stringify(findings, null, 2),
    contentType: "application/json",
  });
  expect(findings).toEqual([]);
});
