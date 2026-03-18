import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { handleInboundEmail } from "./inboundEmail";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/resend-inbound",
  method: "POST",
  handler: handleInboundEmail,
});

http.route({
  path: "/resend-inbound",
  method: "GET",
  handler: httpAction(
    async () =>
      new Response(
        "Resend inbound webhook endpoint. Configure Resend to POST email.received events here.",
        { headers: { "Content-Type": "text/plain" } },
      ),
  ),
});

export default http;
