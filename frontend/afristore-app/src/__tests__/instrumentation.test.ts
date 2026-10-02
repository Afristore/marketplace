import { register, onRequestError } from "../../instrumentation";
import * as Sentry from "@sentry/nextjs";

jest.mock("@sentry/nextjs", () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

describe("instrumentation.ts error handling", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("registers server config cleanly under nodejs runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(register()).resolves.not.toThrow();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("registers edge config cleanly under edge runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(register()).resolves.not.toThrow();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("handles onRequestError and sends exception to Sentry", async () => {
    const error = new Error("Test request error");
    const request = {
      path: "/api/test",
      method: "POST",
      headers: { "user-agent": "test-agent" },
    };

    await onRequestError(error, request);

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      contexts: {
        request: {
          url: "/api/test",
          method: "POST",
          headers: { "user-agent": "test-agent" },
        },
      },
    });
  });

  it("handles Sentry capture failures gracefully without unhandled rejection", async () => {
    (Sentry.captureException as jest.Mock).mockImplementationOnce(() => {
      throw new Error("Sentry transport network failure");
    });

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("App crash");
    const request = { path: "/dashboard", method: "GET", headers: {} };

    await expect(onRequestError(error, request)).resolves.not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
