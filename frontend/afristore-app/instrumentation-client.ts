import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Filter out expected errors
  beforeSend(event, hint) {
    const error = hint.originalException;

    // Filter out wallet connection cancellations
    if (error && typeof error === "object" && "message" in error) {
      const message = String(error.message).toLowerCase();
      if (
        message.includes("user rejected") ||
        message.includes("user cancelled") ||
        message.includes("user denied")
      ) {
        return null;
      }
    }

    return event;
  },

  environment: process.env.NODE_ENV,
});
