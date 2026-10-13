"use client";

import { useEffect, useState } from "react";

/** Re-check the event's end time in the browser so cached pages stay current. False during SSR. */
export function useEventEnded(endIso: string): boolean {
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    const check = () => setEnded(Date.now() >= new Date(endIso).getTime());
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [endIso]);
  return ended;
}
