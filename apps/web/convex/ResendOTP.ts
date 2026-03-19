import { Email } from "@convex-dev/auth/providers/Email";
import { isAllowedUniversityEmail } from "@hop/shared";
import { Resend as ResendAPI } from "resend";
import { buildOtpEmail } from "../lib/notification-email";

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
      html: buildOtpEmail(token),
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
