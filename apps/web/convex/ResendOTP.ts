import { Email } from "@convex-dev/auth/providers/Email";
import { isAllowedUniversityEmail } from "@hop/shared";
import { Resend as ResendAPI } from "resend";

export const ResendOTP = Email({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 60 * 10, // 10 minutes
  async generateVerificationToken() {
    return String(Math.floor(100000 + Math.random() * 900000));
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    if (!isAllowedUniversityEmail(email)) {
      throw new Error("Please use a valid NUS email address.");
    }
    const resend = new ResendAPI(provider.apiKey ?? "");
    const from = process.env.RESEND_FROM_EMAIL ?? "Hop <login@hophome.app>";
    const { error } = await resend.emails.send({
      from,
      to: [email],
      subject: "Your Hop verification code",
      html: [
        '<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">',
        "<h2>Your verification code</h2>",
        `<p style="font-size:32px;letter-spacing:8px;font-weight:bold;text-align:center;margin:24px 0">${token}</p>`,
        "<p>This code expires in 10 minutes. If you did not request this code you can safely ignore this email.</p>",
        "<p style='color:#888;font-size:12px'>Hop — privacy-first campus rideshare</p>",
        "</div>",
      ].join(""),
    });
    if (error) {
      throw new Error(`Failed to send OTP email: ${JSON.stringify(error)}`);
    }
  },
  async authorize(params, account) {
    const email = params.email ?? params.identifier;
    if (typeof email !== "string" || !isAllowedUniversityEmail(email)) {
      throw new Error("Please use a valid NUS email address.");
    }
  },
});
