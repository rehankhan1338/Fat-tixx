"use client";

import { useEffect, useRef } from "react";

/**
 * Honeypot + render timestamp checked by `humanCheck()` on the server. Invisible to people and screen readers.
 * The visible part, the CAPTCHA, is <Captcha /> (src/components/captcha.tsx), placed next to the form's submit button.
 */
export function BotFields() {
  const ft = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ft.current) ft.current.value = String(Date.now()); }, []);
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
      <label>Homepage<input type="text" name="homepage" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
      <input ref={ft} type="hidden" name="_ft" defaultValue="" />
    </div>
  );
}
