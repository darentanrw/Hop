import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { Resend } from "resend";
import { internal } from "./_generated/api";
import { api } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";

export const sendVerificationEmail = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const user = await ctx.runQuery(api.queries.currentUser, {});
    if (!user?.email) throw new Error("User has no email");
    if (user.emailVerified) return { sent: true };

    const words = [
      "apple",
      "banana",
      "cherry",
      "dragon",
      "eagle",
      "forest",
      "garden",
      "harbor",
      "island",
      "jungle",
      "kiwi",
      "lemon",
      "maple",
      "nectar",
      "olive",
      "pearl",
      "quartz",
      "river",
      "sunset",
      "tiger",
      "umbrella",
      "violet",
      "willow",
      "xenon",
      "yarrow",
      "zebra",
      "anchor",
      "breeze",
      "coral",
      "daisy",
      "ember",
      "fjord",
      "glacier",
      "harvest",
      "indigo",
      "juniper",
      "kelp",
      "lantern",
      "meadow",
      "nebula",
      "opal",
      "prairie",
      "quokka",
      "reef",
      "sage",
      "thicket",
      "umber",
      "valley",
      "walnut",
      "yonder",
      "zenith",
      "acorn",
      "birch",
      "cloud",
      "dew",
      "elm",
      "fig",
      "grove",
      "hill",
      "ivy",
      "jade",
      "kite",
      "lake",
      "moss",
      "nutmeg",
      "oak",
      "pebble",
      "quartzite",
      "rose",
      "spruce",
      "tulip",
      "urchin",
      "vine",
      "wave",
      "yucca",
      "zephyr",
      "aurora",
      "bison",
      "clover",
      "dune",
      "echo",
      "flint",
      "gale",
      "hazel",
      "iris",
      "jasmine",
      "koala",
      "linden",
      "marble",
      "nymph",
      "onyx",
      "palm",
      "quail",
      "raven",
      "shale",
      "thrush",
      "umbra",
      "verve",
      "willow",
      "yew",
      "zinnia",
      "apricot",
      "bamboo",
      "coyote",
      "dandelion",
      "evergreen",
      "fern",
      "geyser",
      "heather",
      "ironwood",
      "jackal",
      "kelvin",
      "lupine",
      "mist",
      "nightjar",
      "osprey",
      "petal",
      "quiver",
      "reed",
      "shadow",
      "tundra",
      "ursa",
      "vista",
      "wren",
      "yeti",
      "zen",
      "agate",
      "beech",
      "cedar",
      "drift",
      "elmwood",
      "falcon",
      "groove",
      "haze",
      "ink",
      "junco",
      "kestrel",
      "lichen",
      "monsoon",
      "nectarine",
    ];
    const passphrase = [
      words[Math.floor(Math.random() * words.length)],
      words[Math.floor(Math.random() * words.length)],
      words[Math.floor(Math.random() * words.length)],
    ].join("-");

    await ctx.runMutation(internal.verification.createVerificationRecord, {
      userId,
      passphrase,
      email: user.email,
    });

    const apiKey = process.env.AUTH_RESEND_KEY;
    const from = process.env.RESEND_FROM_EMAIL ?? "Hop <login@hophome.app>";
    const replyTo = process.env.RESEND_INBOUND_ADDRESS;

    if (apiKey) {
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from,
        to: user.email,
        ...(replyTo && { replyTo }),
        subject: "Verify your Hop account",
        html: [
          '<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">',
          "<h2>Verify your email</h2>",
          "<p>To complete your Hop sign-up, reply to this email with the following passphrase:</p>",
          `<p style="font-size:20px;font-weight:bold;text-align:center;margin:24px 0;letter-spacing:2px">${passphrase}</p>`,
          "<p><strong>Reply with the exact passphrase above.</strong> Capitalization does not matter, and extra signature or quoted reply text is okay.</p>",
          "<p>Keep the same hyphens and word order when you reply so we can verify it securely.</p>",
          "<p style='color:#888;font-size:12px'>Hop — privacy-first campus rideshare</p>",
          "</div>",
        ].join(""),
      });
      if (error) throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
    } else if (process.env.NODE_ENV !== "production") {
      console.log(`[dev] Verification passphrase for ${user.email}: ${passphrase}`);
    } else {
      throw new Error("AUTH_RESEND_KEY required to send verification email");
    }

    return { sent: true };
  },
});

export const createVerificationRecord = internalMutation({
  args: {
    userId: v.id("users"),
    passphrase: v.string(),
    email: v.string(),
  },
  handler: async (ctx, { userId, passphrase, email }) => {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await ctx.db
      .query("emailVerifications")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();

    for (const record of existing) {
      if (!record.verifiedAt && record.expiresAt > Date.now()) {
        await ctx.db.patch(record._id, {
          expiresAt: Date.now() - 1,
          pendingAliasFrom: undefined,
          pendingAliasName: undefined,
        });
      }
    }

    await ctx.db.insert("emailVerifications", {
      userId,
      passphrase,
      email: normalizedEmail,
      expiresAt: Date.now() + 60 * 60 * 24 * 1000,
    });
  },
});
