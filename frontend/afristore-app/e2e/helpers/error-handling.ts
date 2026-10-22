import type { Page, Request, Route } from "@playwright/test";

type RouteHandler = (route: Route, request: Request) => Promise<void> | void;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `page.goto` that rethrows failures with the target URL in the message, so a dead
 * dev server or a blocked route is obvious in the report.
 */
export async function safeGoto(page: Page, url: string, options?: Parameters<Page["goto"]>[1]) {
  try {
    return await page.goto(url, options);
  } catch (error) {
    throw new Error(`Navigation to "${url}" failed: ${errorMessage(error)}`);
  }
}

/** `page.reload` that rethrows failures with the current URL in the message. */
export async function safeReload(page: Page, options?: Parameters<Page["reload"]>[0]) {
  try {
    return await page.reload(options);
  } catch (error) {
    throw new Error(`Reload of "${page.url()}" failed: ${errorMessage(error)}`);
  }
}

/**
 * Wraps an async `page.route` handler so a mock that throws (or fires after the page
 * has closed) aborts that one request instead of becoming an unhandled promise rejection.
 */
export function guardRoute(handler: RouteHandler): RouteHandler {
  return async (route, request) => {
    try {
      await handler(route, request);
    } catch (error) {
      console.error(`[e2e] route handler failed for ${request.url()}: ${errorMessage(error)}`);
      await route.abort("failed").catch(() => undefined);
    }
  };
}

/**
 * Records uncaught errors raised inside the app (including unhandled promise
 * rejections), logs them, and returns the live list so a test can assert on it.
 */
export function collectPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (error) => {
    errors.push(error);
    console.error(`[e2e] uncaught page error: ${error.message}`);
  });
  return errors;
}
