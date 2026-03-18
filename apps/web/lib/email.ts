import { Resend } from "resend";

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.AUTH_RESEND_KEY) return null;
  if (!resendClient) {
    resendClient = new Resend(process.env.AUTH_RESEND_KEY);
  }
  return resendClient;
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const client = getResendClient();

  if (!client) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[dev] OTP for ${to}: ${code}`);
      return;
    }
    throw new Error("Email service is not configured.");
  }

  const from = process.env.RESEND_FROM_EMAIL ?? "Hop <login@hophome.app>";

  const { error } = await client.emails.send({
    from,
    to,
    subject: "Your Hop verification code",
    html: [
      '<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">',
      "<h2>Your verification code</h2>",
      `<p style="font-size:32px;letter-spacing:8px;font-weight:bold;text-align:center;margin:24px 0">${code}</p>`,
      "<p>This code expires in 10 minutes. If you did not request this code you can safely ignore this email.</p>",
      "<p style='color:#888;font-size:12px'>Hop — privacy-first campus rideshare</p>",
      "</div>",
    ].join(""),
  });

  if (error) {
    throw new Error(`Failed to send OTP email: ${error.message}`);
  }
}
