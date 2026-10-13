"use client";

/* The platform's live fee settings, for client components that preview fees (pricing calculator, ticket editor). */

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { FeeConfig } from "../money";

const Ctx = createContext<FeeConfig | null>(null);

export function FeesProvider({ fees, children }: { fees: FeeConfig; children: ReactNode }) {
  return <Ctx.Provider value={fees}>{children}</Ctx.Provider>;
}

export function useFees(): FeeConfig {
  const c = useContext(Ctx);
  if (!c) throw new Error("useFees must be used inside <FeesProvider>");
  return c;
}
