export async function register() {
  try {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("./sentry.server.config");
    }

    if (process.env.NEXT_RUNTIME === "edge") {
      await import("./sentry.edge.config");
    }
  } catch (error) {
    console.error("[Instrumentation] Failed to initialize Sentry monitoring:", error);
  }
}

export const onRequestError = async (
  err: Error,
  request: {
    path?: string;
    method?: string;
    headers?: { [key: string]: string | string[] | undefined };
  },
) => {
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(err, {
      contexts: {
        request: {
          url: request?.path,
          method: request?.method,
          headers: request?.headers,
        },
      },
    });
  } catch (sentryError) {
    console.error("[Instrumentation] Failed to log exception to Sentry:", sentryError);
    console.error("[Instrumentation] Original Request Error:", {
      message: err?.message,
      stack: err?.stack,
      requestPath: request?.path,
      requestMethod: request?.method,
    });
  }
};

