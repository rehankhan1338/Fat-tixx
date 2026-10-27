"use client";

import { useEffect } from "react";

/** Navigates from this page, so the browser treats it as a same-site navigation and sends the session cookie. */
export function Forward({ to }: { to: string }) {
  useEffect(() => { window.location.replace(to); }, [to]);
  return <a href={to} className="text-primary underline-offset-4 hover:underline">Continue</a>;
}
