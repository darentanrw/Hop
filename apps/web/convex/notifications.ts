"use node";

import { v } from "convex/values";
import { Resend } from "resend";
import webpush from "web-push";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

function getWebPushConfig() {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT ?? "mailto:hello@hophome.app";

  if (!publicKey || !privateKey) {
    return null;
  }

  return {
    publicKey,
    privateKey,
    subject,
  };
}

function getResendConfig() {
  const apiKey = process.env.AUTH_RESEND_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "Hop <login@hophome.app>";

  if (!apiKey) {
    return null;
  }

  return { apiKey, from };
}

export const dispatchLifecycleNotifications = internalAction({
  args: {
    notifications: v.array(
      v.object({
        userId: v.id("users"),
        groupId: v.optional(v.id("groups")),
        kind: v.string(),
        eventKey: v.string(),
        title: v.string(),
        body: v.string(),
        emailSubject: v.string(),
        emailHtml: v.string(),
      }),
    ),
  },
  handler: async (ctx, { notifications }) => {
    const webPushConfig = getWebPushConfig();
    if (webPushConfig) {
      webpush.setVapidDetails(
        webPushConfig.subject,
        webPushConfig.publicKey,
        webPushConfig.privateKey,
      );
    }

    const resendConfig = getResendConfig();
    const resend = resendConfig ? new Resend(resendConfig.apiKey) : null;

    for (const notification of notifications) {
      const recipient = await ctx.runQuery(internal.notificationsModel.getNotificationRecipient, {
        userId: notification.userId,
      });
      if (!recipient) {
        continue;
      }

      const pushEventKey = `${notification.eventKey}:push`;
      const pushAlreadyHandled = await ctx.runQuery(
        internal.notificationsModel.hasNotificationEvent,
        {
          eventKey: pushEventKey,
        },
      );

      let pushDelivered = false;

      if (!pushAlreadyHandled) {
        if (!webPushConfig) {
          await ctx.runMutation(internal.notificationsModel.recordNotificationEvent, {
            userId: notification.userId,
            groupId: notification.groupId,
            eventKey: pushEventKey,
            kind: notification.kind,
            channel: "push",
            status: "skipped",
            detail: "missing_vapid_config",
          });
        } else if (recipient.subscriptions.length === 0) {
          await ctx.runMutation(internal.notificationsModel.recordNotificationEvent, {
            userId: notification.userId,
            groupId: notification.groupId,
            eventKey: pushEventKey,
            kind: notification.kind,
            channel: "push",
            status: "skipped",
            detail: "no_active_subscription",
          });
        } else {
          let successCount = 0;
          const errors: string[] = [];

          for (const subscription of recipient.subscriptions) {
            try {
              await webpush.sendNotification(
                {
                  endpoint: subscription.endpoint,
                  keys: {
                    p256dh: subscription.p256dh,
                    auth: subscription.auth,
                  },
                },
                JSON.stringify({
                  title: notification.title,
                  body: notification.body,
                  url: notification.groupId ? "/group" : "/dashboard",
                }),
              );
              successCount += 1;
            } catch (error) {
              const message =
                error instanceof Error ? error.message : "Unknown push notification error";
              errors.push(message);

              const statusCode =
                typeof error === "object" &&
                error !== null &&
                "statusCode" in error &&
                typeof error.statusCode === "number"
                  ? error.statusCode
                  : null;

              if (statusCode === 404 || statusCode === 410) {
                await ctx.runMutation(
                  internal.notificationsModel.disablePushSubscriptionByEndpoint,
                  {
                    endpoint: subscription.endpoint,
                  },
                );
              }
            }
          }

          if (successCount > 0) {
            pushDelivered = true;
            await ctx.runMutation(internal.notificationsModel.recordNotificationEvent, {
              userId: notification.userId,
              groupId: notification.groupId,
              eventKey: pushEventKey,
              kind: notification.kind,
              channel: "push",
              status: "sent",
              detail:
                successCount === recipient.subscriptions.length
                  ? undefined
                  : `partial_success:${successCount}/${recipient.subscriptions.length}`,
            });
          } else {
            await ctx.runMutation(internal.notificationsModel.recordNotificationEvent, {
              userId: notification.userId,
              groupId: notification.groupId,
              eventKey: pushEventKey,
              kind: notification.kind,
              channel: "push",
              status: "failed",
              detail: errors[0] ?? "push_failed",
            });
          }
        }
      }

      if (pushDelivered) {
        continue;
      }

      const emailEventKey = `${notification.eventKey}:email`;
      const emailAlreadyHandled = await ctx.runQuery(
        internal.notificationsModel.hasNotificationEvent,
        {
          eventKey: emailEventKey,
        },
      );

      if (emailAlreadyHandled) {
        continue;
      }

      if (!recipient.email) {
        await ctx.runMutation(internal.notificationsModel.recordNotificationEvent, {
          userId: notification.userId,
          groupId: notification.groupId,
          eventKey: emailEventKey,
          kind: notification.kind,
          channel: "email",
          status: "skipped",
          detail: "missing_email",
        });
        continue;
      }

      if (resend && resendConfig) {
        try {
          const { error } = await resend.emails.send({
            from: resendConfig.from,
            to: recipient.email,
            subject: notification.emailSubject,
            html: notification.emailHtml,
          });

          if (error) {
            throw new Error(JSON.stringify(error));
          }

          await ctx.runMutation(internal.notificationsModel.recordNotificationEvent, {
            userId: notification.userId,
            groupId: notification.groupId,
            eventKey: emailEventKey,
            kind: notification.kind,
            channel: "email",
            status: "sent",
          });
        } catch (error) {
          await ctx.runMutation(internal.notificationsModel.recordNotificationEvent, {
            userId: notification.userId,
            groupId: notification.groupId,
            eventKey: emailEventKey,
            kind: notification.kind,
            channel: "email",
            status: "failed",
            detail: error instanceof Error ? error.message : "email_failed",
          });
        }
      } else {
        console.log(
          `[dev] ${notification.kind} email for ${recipient.email}: ${notification.emailSubject}`,
        );
        await ctx.runMutation(internal.notificationsModel.recordNotificationEvent, {
          userId: notification.userId,
          groupId: notification.groupId,
          eventKey: emailEventKey,
          kind: notification.kind,
          channel: "email",
          status: "sent",
          detail: "dev_console_log",
        });
      }
    }

    return { sent: notifications.length };
  },
});
