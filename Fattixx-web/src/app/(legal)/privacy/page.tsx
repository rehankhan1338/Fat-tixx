import type { Metadata } from "next";
import { loadLegal } from "@/lib/home/legal";
import { PublicPage } from "@/components/layout/PublicPage";
import LegalPage from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Fattixx collects, uses and shares personal information, and the choices you have.",
};

export default function PrivacyPage() {
  return (
    <PublicPage>
      <LegalPage content={loadLegal("privacy")} />
    </PublicPage>
  );
}
