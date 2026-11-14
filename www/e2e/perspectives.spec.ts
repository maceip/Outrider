import { expect, test } from "@playwright/test";

test("home visit, day strip, door, and a film route", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/");
  const mark = page.locator("header img");
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute("src", "/mark/mark-white.png");
  const markResponse = await page.request.get("/mark/mark-white.png");
  expect(markResponse.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "One visit. Four sides." })).toBeVisible();
  await expect(page.locator("video")).not.toHaveAttribute("autoplay", "");

  const greet = page.locator("[data-ch='0']");
  const assess = page.locator("[data-ch='1']");
  await expect(greet).toBeVisible();
  await page.getByRole("tab", { name: "02 Assess" }).click();
  await expect(assess).toBeVisible();
  await expect(greet).toBeHidden();
  await expect(page.locator("#board")).toHaveAttribute("data-chapter", "1");
  await page.getByRole("tab", { name: "02 Assess" }).press("ArrowRight");
  await expect(page.locator("#board")).toHaveAttribute("data-chapter", "2");

  const date = await page.locator("[data-day='date']").first().innerText();
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByText("They are not from real shops.")).toBeVisible();
  const through = Number((await page.locator("[data-day='through']").innerText()).replaceAll(",", ""));
  const verify = Number((await page.locator("[data-day='verify']").first().innerText()).replaceAll(",", ""));
  const blocked = Number((await page.locator("[data-day='blocked']").innerText()).replaceAll(",", ""));
  const total = Number((await page.locator("[data-day='total']").first().innerText()).replaceAll(",", ""));
  expect(through + verify + blocked).toBe(total);
  expect(total).toBeGreaterThan(0);

  await page.getByRole("button", { name: "What happens without Silvector?" }).click();
  await expect(page.getByText("Nobody writes down who sent the agent.")).toBeVisible();

  await page.locator("#door-domain").fill("not a domain");
  await page.getByRole("button", { name: "Scan in the demo" }).click();
  await expect(page.locator("#door-status")).toHaveText("Type a website name, like yourshop.com.");
  await expect(page).toHaveURL(/127\.0\.0\.1/);

  await page.route("https://demo.silvector.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>scan</title><p>scan</p>",
    }),
  );
  await page.locator("#door-domain").fill("https://www.YourShop.com/cart");
  await Promise.all([
    page.waitForURL("https://demo.silvector.com/#/readiness/yourshop.com"),
    page.getByRole("button", { name: "Scan in the demo" }).click(),
  ]);
  await page.goto("/");

  await page.getByRole("link", { name: "The customer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The customer's view" })).toBeVisible();
  const video = page.locator("video");
  const source = page.locator("video source");
  const src = await source.getAttribute("src");
  expect(src).toBe("/media/film/customer.mp4");
  const response = await page.request.get(src!);
  expect(response.status()).toBe(200);
  await expect(video).not.toHaveJSProperty("autoplay", true);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
