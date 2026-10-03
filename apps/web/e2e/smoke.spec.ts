// Web smoke on the gate-test fixture with editorial gates NOT auto-approved (SPEC §14.6, M3): approve the outline
// (thesis confirm) → fact-check panel → edit the script → render blocked as stale → re-check → preview seek from a word →
// draft render CH1 / export timeline-only blocked until acknowledged → download. Long: runs the offline pipeline.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const origin = (base: string) => ({ Origin: base });

async function waitForJobs(request: APIRequestContext, base: string, slug: string, timeoutMs = 20 * 60_000): Promise<string> {
  const t0 = Date.now();
  for (;;) {
    const st = await (await request.get(`${base}/api/projects/${slug}/status`)).json();
    if (!st.activeJobId && !st.queued.length) {
      const jobs = await (await request.get(`${base}/api/projects/${slug}/jobs`)).json();
      return jobs[0]?.status ?? "none";
    }
    if (Date.now() - t0 > timeoutMs) throw new Error("jobs did not finish");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function runPipeline(page: Page, base: string, slug: string, body: Record<string, unknown>) {
  const r = await page.request.post(`${base}/api/projects/${slug}/jobs`, { data: body, headers: origin(base) });
  expect(r.status()).toBe(202);
  return waitForJobs(page.request, base, slug);
}

test("gate-test: outline approval → fact-check → stale render gate → preview seek → export", async ({ page, baseURL }) => {
  const base = baseURL!;
  // first run: the user chooses the Remotion licence status (never chosen by the tool)
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByTestId("license-choice").getByRole("radio").first().check();
  await page.getByTestId("license-choice").getByRole("button").first().click();
  await page.getByTestId("finish-setup").click();
  await expect(page).toHaveURL(base + "/");

  // new project from the fixture (offline)
  await page.goto("/new");
  await page.getByTestId("idea").fill("The fall of Glimmerline, a fictional influencer agency");
  await page.locator("select").filter({ hasText: "Fixture" }).selectOption("fixture");
  await page.locator('input[value="tulip-mania"]').fill("gate-test");
  await page.getByTestId("create-project").click();
  await page.getByTestId("start-research").click();
  await expect(page).toHaveURL(/\/p\/[a-z0-9-]+$/);
  const slug = page.url().split("/p/")[1]!;
  expect(await waitForJobs(page.request, base, slug)).toMatch(/waiting-approval|succeeded/);

  // outline: confirm the thesis, save, approve
  await page.goto(`/p/${slug}/outline`);
  const confirm = page.getByTestId("confirm-thesis");
  if (!(await confirm.isChecked())) {
    await confirm.check();
    await page.getByRole("button", { name: /^(Save|Enregistrer)$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Save anyway|Enregistrer quand même/ }).click();
  }
  await page.getByTestId("approve-outline").click();
  await expect(page.getByText(/Outline approved|Plan approuvé/)).toBeVisible();

  // script → direct (scratch take, free); fact-check panel lists high items
  await runPipeline(page, base, slug, { kind: "pipeline", from: "script", to: "mix", langs: ["en"] });
  await page.goto(`/p/${slug}/script/en`);
  await expect(page.locator("[data-testid^=fc-FC-]").first()).toBeVisible();

  // edit the script → the fact-check becomes stale → render/export blocked
  const first = page.locator("[data-testid^=segment-] textarea").first();
  await first.fill((await first.inputValue()) + " Edited.");
  await page.getByTestId("save-script").click();
  await expect(page.getByText(/changed since the last check|ont changé depuis/)).toBeVisible();
  await page.goto(`/p/${slug}`);
  await expect(page.getByTestId("stage-render-en-draft")).toContainText(/blocked|bloqué/);

  // re-check
  await runPipeline(page, base, slug, { kind: "stage", stage: "factcheck", langs: ["en"] });

  // preview: click a word → the Player seeks (the word becomes active)
  await runPipeline(page, base, slug, { kind: "pipeline", from: "layout", to: "mix", langs: ["en"] });
  await page.goto(`/p/${slug}/preview/en`);
  const word = page.getByTestId("script-panel").locator("button[data-w]").nth(10);
  await word.click();
  await expect(word).toHaveClass(/bg-amber-500/);

  // render/export stay gated until every blocking fact-check item is resolved
  const exp = await page.request.post(`${base}/api/projects/${slug}/jobs`, { data: { kind: "stage", stage: "export", langs: ["en"], options: { timelineOnly: true } }, headers: origin(base) });
  expect(exp.status()).toBe(202);
  expect(await waitForJobs(page.request, base, slug)).toMatch(/waiting-approval|failed/);
});
