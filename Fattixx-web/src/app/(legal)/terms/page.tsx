import type { Metadata } from "next";
import { loadLegal } from "@/lib/home/legal";
import { PublicPage } from "@/components/layout/PublicPage";
import LegalPage from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for buying tickets and hosting events on Fattixx, including the Organizer Agreement.",
};

export default function TermsPage() {
  return (
    <PublicPage>
      <LegalPage content={loadLegal("terms")} />
    </PublicPage>
  );
}
