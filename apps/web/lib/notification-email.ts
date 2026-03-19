type NotificationEmailAction = {
  href: string;
  label: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveSiteUrl() {
  const configured =
    process.env.SITE_URL?.trim() || process.env.CONVEX_SITE_URL?.trim() || "http://localhost:3000";

  try {
    return new URL(configured).toString();
  } catch {
    return "http://localhost:3000/";
  }
}

export function buildAppUrl() {
  return resolveSiteUrl();
}

export function buildLoginUrl() {
  return new URL("/login", resolveSiteUrl()).toString();
}

function getDefaultAction(): NotificationEmailAction {
  return {
    href: buildAppUrl(),
    label: "Open Hop",
  };
}

function renderEmailAction(action: NotificationEmailAction) {
  return [
    '<div style="margin:20px 0 16px">',
    `<a href="${escapeHtml(action.href)}" style="display:inline-block;background:#101828;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:600">`,
    `${escapeHtml(action.label)}`,
    "</a>",
    "</div>",
  ].join("");
}

function buildEmailLayout(title: string, contentHtml: string, action?: NotificationEmailAction) {
  const resolvedAction = action ?? getDefaultAction();

  return [
    '<div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px">',
    `<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>`,
    contentHtml,
    renderEmailAction(resolvedAction),
    '<p style="margin:0;color:#667085;font-size:12px">Hop keeps your ride group updated automatically.</p>',
    "</div>",
  ].join("");
}

export function buildNotificationEmail(
  title: string,
  body: string,
  action?: NotificationEmailAction,
) {
  return buildEmailLayout(
    title,
    `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(body)}</p>`,
    action,
  );
}

export function buildOtpEmail(code: string) {
  return buildEmailLayout(
    "Your verification code",
    [
      `<p style="font-size:32px;letter-spacing:8px;font-weight:bold;text-align:center;margin:24px 0">${escapeHtml(code)}</p>`,
      '<p style="margin:0 0 12px;line-height:1.5">Enter this code in Hop to finish signing in. It expires in 10 minutes.</p>',
      '<p style="margin:0 0 12px;line-height:1.5">If you did not request this code, you can safely ignore this email.</p>',
    ].join(""),
  );
}

export function buildReplyVerificationEmail(passphrase: string) {
  return buildEmailLayout(
    "Verify your email",
    [
      '<p style="margin:0 0 12px;line-height:1.5">To complete your Hop sign-up, reply to this email with the following passphrase:</p>',
      `<p style="font-size:20px;font-weight:bold;text-align:center;margin:24px 0;letter-spacing:2px">${escapeHtml(passphrase)}</p>`,
      '<p style="margin:0 0 12px;line-height:1.5"><strong>Reply with the exact passphrase above.</strong> Capitalization does not matter, and extra signature or quoted reply text is okay.</p>',
      '<p style="margin:0 0 12px;line-height:1.5">Keep the same hyphens and word order when you reply so we can verify it securely.</p>',
    ].join(""),
  );
}
