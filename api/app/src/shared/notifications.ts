import * as Sentry from "@sentry/node";
import axios from "axios";
import { Config } from "./config";

const slackAlertUrl = Config.getSlackAlertUrl();
const slackNotificationUrl = Config.getSlackNotificationUrl();

export interface SlackMessage {
  message: string;
  subject: string;
  emoji?: string;
}

const sendToSlack = async (
  notif: SlackMessage | string,
  url: string | undefined
): Promise<void> => {
  let subject: string;
  let message: string | undefined = undefined;
  let emoji: string | undefined = undefined;
  if (typeof notif === "string") {
    subject = notif as string;
  } else {
    const n: SlackMessage = notif as SlackMessage;
    message = n.message;
    subject = n.subject;
    emoji = n.emoji ?? emoji;
  }
  if (!url) {
    console.log(`Could not send to Slack, missing URL - ${subject}: ${message ?? "''"}`);
    return;
  }

  const payload = JSON.stringify({
    text: subject + (message ? `:${"\n```\n"}${message}${"\n```"}` : ""),
    ...(emoji ? { icon_emoji: emoji } : undefined),
  });

  return axios.post(url, payload, {
    headers: { "Content-Type": "application/json" },
  });
};

// TODO #156 remove this?
export const sendNotification = async (notif: SlackMessage | string): Promise<void> =>
  sendToSlack(notif, slackNotificationUrl);

// TODO #156 remove this?
export const sendAlert = async (notif: SlackMessage | string): Promise<void> =>
  sendToSlack(notif, slackAlertUrl);

export type CaptureContext = {
  user: { id?: string; email?: string };
  extra: Record<string, unknown>;
  tags: {
    [key: string]: string;
  };
};

/**
 * Captures an exception event and sends it to Sentry.
 *
 * @param error — An Error object.
 * @param captureContext — Additional scope data to apply to exception event.
 * @returns — The generated eventId.
 */
//eslint-disable-next-line @typescript-eslint/no-explicit-any
export function captureError(error: any, captureContext?: Partial<CaptureContext>): string {
  return Sentry.captureException(error, captureContext);
}

export type SeverityLevel = "fatal" | "error" | "warning" | "log" | "info" | "debug";

/**
 * Captures an exception event and sends it to Sentry.
 *
 * @param message The message to send to Sentry.
 * @param captureContext — Additional scope data to apply to exception event.
 * @returns — The generated eventId.
 */
export function captureMessage(
  message: string,
  captureContext?: Partial<CaptureContext> | SeverityLevel
): string {
  return Sentry.captureMessage(message, captureContext);
}
