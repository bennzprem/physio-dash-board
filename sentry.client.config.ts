// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const isDev = process.env.NODE_ENV === "development";
const enableInDev =
  process.env.NEXT_PUBLIC_ENABLE_SENTRY === "true" ||
  process.env.ENABLE_SENTRY_IN_DEV === "true";
// In production, always enable Sentry if DSN is provided (needed for feedback widget)
// In development, only enable if explicitly opted-in
const isEnabled = Boolean(dsn) && (!isDev || enableInDev);

// Initialize Sentry if DSN is provided (needed for feedback widget to work)
// The enabled flag controls whether events are actually sent
if (dsn) {
  Sentry.init({
    dsn: dsn,
    // Always enable in production if DSN exists (feedback widget requires this)
    // In dev, respect the enableInDev flag
    enabled: isEnabled,

    // Adjust this value in production, or use tracesSampler for greater control
    tracesSampleRate: 1,

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: process.env.NODE_ENV === "development" && enableInDev,

    replaysOnErrorSampleRate: 1.0,

    // This sets the sample rate to be 10%. You may want this to be 100% while
    // in development and sample at a lower rate in production
    replaysSessionSampleRate: 0.1,

    // You can remove this option if you're not planning to use the Sentry Session Replay feature:
    integrations: [
      Sentry.replayIntegration({
        // Additional Replay configuration goes in here, for example:
        maskAllText: true,
        blockAllMedia: true,
      }),
      // Feedback widget removed - user requested removal
      // Sentry.feedbackIntegration({
      //   autoInject: true,
      //   colorScheme: "system",
      //   showEmail: true,
      //   showName: true,
      // }),
    ],
  });
}

