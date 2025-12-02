// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
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

    // Add optional integrations for additional features
    integrations: [
      Sentry.replayIntegration(),
      // Feedback widget removed - user requested removal
      // Sentry.feedbackIntegration({
      //   autoInject: true,
      //   colorScheme: "system",
      //   showEmail: true,
      //   showName: true,
      // }),
    ],

    // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
    tracesSampleRate: 1,
    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Define how likely Replay events are sampled.
    // This sets the sample rate to be 10%. You may want this to be 100% while
    // in development and sample at a lower rate in production
    replaysSessionSampleRate: 0.1,

    // Define how likely Replay events are sampled when an error occurs.
    replaysOnErrorSampleRate: 1.0,

    // Enable sending user PII (Personally Identifiable Information)
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
    sendDefaultPii: true,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;