import { isNusAliasFormat } from "@hop/shared";
import { Resend } from "resend";
import {
  buildInboundBodyText,
  extractEmailFromFromField,
  extractNameFromFromField,
  extractPassphraseFromBody,
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
  const passphrase = extractPassphraseFromBody(bodyText);
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

  if (verification) {
    if (!passphrase || passphrase.toLowerCase() !== verification.passphrase.toLowerCase()) {
      console.log(`[inbound] Passphrase mismatch for ${senderEmail}`);
      return new Response("OK", { status: 200 });
    }
    await ctx.runMutation(internal.inboundMutations.verifyEmailReply, {
      verificationId: verification.id,
      name: name || undefined,
    });
    console.log(`[inbound] Email verified for ${senderEmail}${name ? `, name: ${name}` : ""}`);
    return new Response("OK", { status: 200 });
  }

  if (!passphrase) {
    console.log(`[inbound] No pending verification for ${senderEmail}, no passphrase in reply`);
    return new Response("OK", { status: 200 });
  }

  const byPassphrase = await ctx.runQuery(
    internal.inboundMutations.getPendingVerificationByPassphrase,
    { passphrase },
  );
  if (!byPassphrase) {
    console.log(`[inbound] No verification with matching passphrase from ${senderEmail}`);
    return new Response("OK", { status: 200 });
  }

  if (byPassphrase.email.toLowerCase() === senderEmail) {
    await ctx.runMutation(internal.inboundMutations.verifyEmailReply, {
      verificationId: byPassphrase.id,
      name: name || undefined,
    });
    console.log(`[inbound] Email verified for ${senderEmail}`);
    return new Response("OK", { status: 200 });
  }

  if (isNusAliasFormat(byPassphrase.email)) {
    await ctx.runMutation(internal.inboundMutations.storePendingAlias, {
      verificationId: byPassphrase.id,
      aliasFrom: senderEmail,
      aliasName: name || undefined,
    });
    console.log(`[inbound] Pending alias: ${senderEmail} for signup ${byPassphrase.email}`);
  } else {
    console.log(
      `[inbound] Reply from ${senderEmail} does not match signup ${byPassphrase.email} (exact match required)`,
    );
  }
  return new Response("OK", { status: 200 });
});
