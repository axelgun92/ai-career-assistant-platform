import { expect, test } from "@playwright/test";

test("serves the application shell and health endpoint", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI Career Platform" })).toBeVisible();

  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({
    status: "ok",
    service: "ai-career-platform",
  });
});
