"use client";

import ApplyForm from "@/app/merchant/apply/ApplyForm";

type Props = {
  initialCityId?: string;
  referralCode?: string;
};

export default function RestaurantApplyForm({ initialCityId, referralCode }: Props) {
  return (
    <ApplyForm
      cityId={initialCityId}
      referralCode={referralCode}
      prefillMerchantType="restaurant"
    />
  );
}
