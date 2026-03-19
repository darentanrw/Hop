import { Resend } from "resend";
import { buildOtpEmail } from "./notification-email";

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
    html: buildOtpEmail(code),
  });

  if (error) {
    throw new Error(`Failed to send OTP email: ${error.message}`);
  }
}
