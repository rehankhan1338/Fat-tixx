"use client";

import { CampaignForm, EMPTY_CAMPAIGN } from "@/components/ads/campaign-form";

export function NewCampaign({ categories }: { categories: string[] }) {
  return <CampaignForm values={EMPTY_CAMPAIGN} categories={categories} afterCreateHref={(id) => `/admin/ads/${id}`} />;
}
