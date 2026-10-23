"use client";

import { CampaignForm, EMPTY_CAMPAIGN } from "@/components/ads/campaign-form";

export function NewAdvertiserCampaign({ categories }: { categories: string[] }) {
  return <CampaignForm advertiser values={{ ...EMPTY_CAMPAIGN, kind: "sponsored", placements: ["event_list", "event_detail"] }} categories={categories} afterCreateHref={(id) => `/advertiser/campaigns/${id}`} />;
}
