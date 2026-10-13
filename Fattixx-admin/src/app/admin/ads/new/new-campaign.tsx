"use client";

import { CampaignForm, EMPTY_CAMPAIGN } from "@/components/ads/campaign-form";

export function NewCampaign() {
  return <CampaignForm values={EMPTY_CAMPAIGN} afterCreateHref={(id) => `/admin/ads/${id}`} />;
}
