import { expect, test } from "@playwright/test";

test("serves the application shell and health endpoint", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI Career Platform" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Opportunities" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New opportunity" })).toBeVisible();

  await page.goto("/opportunities/new");
  await expect(
    page.getByLabel("Raw opportunity or job-description text"),
  ).toBeVisible();

  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    status: "ok",
    service: "ai-career-platform",
    database: "ok",
    aiConfigured: true,
  });
});
