import { describe, expect, test } from "vitest";
import {
  buildInboundBodyText,
  extractEmailFromFromField,
  extractPassphraseFromBody,
} from "../../lib/inbound-email";

describe("inbound email parsing", () => {
  test("extracts passphrases containing three-letter words", () => {
    expect(extractPassphraseFromBody("dew-elm-fig")).toBe("dew-elm-fig");
    expect(extractPassphraseFromBody("Replying with oak-yew-zen")).toBe("oak-yew-zen");
  });

  test("falls back to html when text is empty", () => {
    const body = buildInboundBodyText({
      text: "",
      html: "<p>passphrase: ink-ivy-oak</p>",
    });

    expect(extractPassphraseFromBody(body)).toBe("ink-ivy-oak");
  });

  test("extracts sender email from a quoted from header", () => {
    expect(extractEmailFromFromField('"Alex Tan" <alex@u.nus.edu>')).toBe("alex@u.nus.edu");
  });
});
