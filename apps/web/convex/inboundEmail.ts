import { Resend } from "resend";
import {
  buildInboundBodyText,
  extractEmailFromFromField,
  extractNameFromFromField,
  resolveInboundVerificationDecision,
} from "../lib/inbound-email";
import { api, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

export const handleInboundEmail = httpAction(async (ctx, request) => {
  const body = (await request.json()) as {
    type?: string;
    data?: { email_id?: string; from?: string; to?: string[] };
  };
  if (body.type !== "email.received" || !body.data?.email_id) {
    return new Response("Invalid webhook payload", { status: 400 });
  }
  const { email_id: emailId, from: fromField } = body.data;
  console.log(`[inbound] Received email.received webhook, from: ${fromField}`);

  const apiKey = process.env.AUTH_RESEND_KEY;
  if (!apiKey) {
    console.error("AUTH_RESEND_KEY not set");
    return new Response("Server configuration error", { status: 500 });
  }

  const resend = new Resend(apiKey);
  const { data: email, error } = await resend.emails.receiving.get(emailId);
  if (error || !email) {
    console.error("Failed to fetch received email:", error);
    return new Response("Failed to process email", { status: 500 });
  }

  const bodyText = buildInboundBodyText(email);
  const fromForName =
    (email as { headers?: { from?: string } }).headers?.from ??
    (email as { from?: string }).from ??
    fromField ??
    "";
  const senderEmail = extractEmailFromFromField(fromForName);
  if (!senderEmail) {
    console.error("[inbound] Missing or invalid sender email:", fromForName);
    return new Response("Missing sender", { status: 400 });
  }
  const name = extractNameFromFromField(fromForName);

  const verification = await ctx.runQuery(api.queries.getPendingVerificationByEmail, {
    email: senderEmail,
  });

  const verificationByBody = verification
    ? null
    : await ctx.runQuery(internal.inboundMutations.getPendingVerificationByBody, {
        bodyText,
      });

  const decision = resolveInboundVerificationDecision({
    senderEmail,
    bodyText,
    verificationByEmail: verification,
    verificationByBody,
  });

  if (decision.kind === "verify") {
    await ctx.runMutation(internal.inboundMutations.verifyEmailReply, {
      verificationId: decision.verificationId,
      name: name || undefined,
    });
    console.log(`[inbound] Email verified for ${senderEmail}${name ? `, name: ${name}` : ""}`);
    return new Response("OK", { status: 200 });
  }

  if (decision.kind === "pending_alias") {
    await ctx.runMutation(internal.inboundMutations.storePendingAlias, {
      verificationId: decision.verificationId,
      aliasFrom: senderEmail,
      aliasName: name || undefined,
    });
    console.log(`[inbound] Pending alias: ${senderEmail} for signup ${decision.signupEmail}`);
    return new Response("OK", { status: 200 });
  }

  if (decision.reason === "passphrase_mismatch") {
    console.log(`[inbound] Passphrase mismatch for ${senderEmail}`);
  } else if (decision.reason === "exact_match_required") {
    console.log(
      `[inbound] Reply from ${senderEmail} does not match signup ${verificationByBody?.email} (exact match required)`,
    );
  } else {
    console.log(`[inbound] No verification with matching passphrase from ${senderEmail}`);
  }

  return new Response("OK", { status: 200 });
});
