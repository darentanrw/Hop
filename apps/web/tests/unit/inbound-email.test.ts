import { describe, expect, test } from "vitest";
import {
  bodyContainsPassphrase,
  buildInboundBodyText,
  extractEmailFromFromField,
  findNewestVerificationMatchByBody,
  resolveInboundVerificationDecision,
} from "../../lib/inbound-email";

describe("inbound email parsing", () => {
  test("matches the exact hyphenated passphrase case-insensitively", () => {
    expect(bodyContainsPassphrase("dew-elm-fig", "dew-elm-fig")).toBe(true);
    expect(bodyContainsPassphrase("DEW-ELM-FIG", "dew-elm-fig")).toBe(true);
  });

  test("rejects space-separated words and typos", () => {
    expect(bodyContainsPassphrase("DEW ELM FIG", "dew-elm-fig")).toBe(false);
    expect(bodyContainsPassphrase("dew-elim-fig", "dew-elm-fig")).toBe(false);
    expect(bodyContainsPassphrase("fig-elm-dew", "dew-elm-fig")).toBe(false);
    expect(bodyContainsPassphrase("oak-yew-zen", "dew-elm-fig")).toBe(false);
  });

  test("allows signatures and quoted threads around the exact passphrase", () => {
    expect(bodyContainsPassphrase("dew-elm-fig\n\n-- \nAlex Tan", "dew-elm-fig")).toBe(true);
    expect(
      bodyContainsPassphrase(
        "Thanks\n\nOn Tue, Hop wrote:\n> Verify with dew-elm-fig\n> Keep the same hyphens",
        "dew-elm-fig",
      ),
    ).toBe(true);
  });

  test("prefers plain text over html", () => {
    const body = buildInboundBodyText({
      text: "dew-elm-fig",
      html: "<p>oak-yew-zen</p>",
    });

    expect(body).toBe("dew-elm-fig");
    expect(bodyContainsPassphrase(body, "dew-elm-fig")).toBe(true);
    expect(bodyContainsPassphrase(body, "oak-yew-zen")).toBe(false);
  });

  test("falls back to html-only replies with markup between passphrase segments", () => {
    const body = buildInboundBodyText({
      text: "",
      html: "<p><strong>DEW</strong>&nbsp;-&nbsp;<em>ELM</em>&nbsp;-&nbsp;FIG</p>",
    });

    expect(bodyContainsPassphrase(body, "dew-elm-fig")).toBe(true);
  });

  test("extracts sender email from a quoted from header", () => {
    expect(extractEmailFromFromField('"Alex Tan" <alex@u.nus.edu>')).toBe("alex@u.nus.edu");
  });

  test("finds the newest active verification whose stored passphrase appears in the body", () => {
    const match = findNewestVerificationMatchByBody(
      [
        {
          _creationTime: 1,
          id: "older",
          email: "alex@u.nus.edu",
          passphrase: "dew-elm-fig",
        },
        {
          _creationTime: 2,
          id: "newer",
          email: "alex@u.nus.edu",
          passphrase: "dew-elm-fig",
        },
      ],
      "Please verify me with DEW-ELM-FIG\n\n-- Alex",
    );

    expect(match?.id).toBe("newer");
  });

  test("direct sender verification still requires the exact hyphenated passphrase", () => {
    expect(
      resolveInboundVerificationDecision({
        senderEmail: "alex@u.nus.edu",
        bodyText: "DEW-ELM-FIG",
        verificationByEmail: {
          id: "verification-1",
          passphrase: "dew-elm-fig",
        },
        verificationByBody: null,
      }),
    ).toEqual({
      kind: "verify",
      verificationId: "verification-1",
    });

    expect(
      resolveInboundVerificationDecision({
        senderEmail: "alex@u.nus.edu",
        bodyText: "DEW ELM FIG",
        verificationByEmail: {
          id: "verification-1",
          passphrase: "dew-elm-fig",
        },
        verificationByBody: null,
      }),
    ).toEqual({
      kind: "none",
      reason: "passphrase_mismatch",
    });
  });

  test("alias replies still require confirmation instead of auto-verifying", () => {
    expect(
      resolveInboundVerificationDecision({
        senderEmail: "alex.tan@nus.edu.sg",
        bodyText: "DEW-ELM-FIG",
        verificationByEmail: null,
        verificationByBody: {
          id: "verification-2",
          email: "e1234567@u.nus.edu",
        },
      }),
    ).toEqual({
      kind: "pending_alias",
      verificationId: "verification-2",
      signupEmail: "e1234567@u.nus.edu",
    });
  });
});
