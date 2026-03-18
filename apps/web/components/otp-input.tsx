"use client";

import { type ClipboardEvent, type KeyboardEvent, useRef, useState } from "react";

type OtpInputProps = {
  length?: number;
  onComplete: (code: string) => void;
  disabled?: boolean;
};

export function OtpInput({ length = 6, onComplete, disabled }: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function handleChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;

    const next = [...digits];
    next[index] = value.slice(-1);
    setDigits(next);

    if (value && index < length - 1) {
      refs.current[index + 1]?.focus();
    }

    const code = next.join("");
    if (code.length === length && next.every(Boolean)) {
      onComplete(code);
    }
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    const next = [...digits];
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i];
    }
    setDigits(next);

    if (pasted.length === length) {
      onComplete(pasted);
    } else {
      refs.current[Math.min(pasted.length, length - 1)]?.focus();
    }
  }

  return (
    <div className="otp-group">
      {digits.map((digit, index) => (
        <input
          key={`digit-${index}`}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          className={`otp-digit ${digit ? "filled" : ""}`}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          disabled={disabled}
          aria-label={`Digit ${index + 1}`}
        />
      ))}
    </div>
  );
}
