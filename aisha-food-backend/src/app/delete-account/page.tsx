import type { Metadata } from "next";
import PublicInfoPage from "../_components/PublicInfoPage";
import DeleteAccountRequestForm from "./DeleteAccountRequestForm";

export const metadata: Metadata = {
  title: "Delete Account | OranjeEats",
  description:
    "Request deletion of a customer, merchant, or driver account and learn which records may be retained for legal, payment, and fraud-prevention reasons.",
};

export default function DeleteAccountPage() {
  return (
    <PublicInfoPage
      eyebrow="Account deletion"
      title="Delete your OranjeEats account"
      description="Customers, merchants, and drivers can request account deletion. This page explains what will be deleted, what may be retained for legal or payment obligations, and how to contact support."
      sections={[
        {
          title: "How deletion requests work",
          body: [
            "Submit a deletion request through the form below or email support@oranjeeats.com directly. Our team may ask you to verify control of the phone number, email address, or device session linked to the account.",
          ],
        },
        {
          title: "What we delete",
          bullets: [
            "Profile data that is no longer required for active service operations.",
            "Stored account preferences and inactive session access where deletion is permitted.",
            "Non-essential operational data once the retention period has expired.",
          ],
        },
        {
          title: "What we may retain",
          bullets: [
            "Order, payout, refund, and settlement records required for accounting, tax, or payment reconciliation.",
            "Security, fraud-prevention, abuse, or dispute records where retention is legally necessary or operationally justified.",
            "Limited delivery or payment evidence needed to respond to chargebacks, law-enforcement requests, or safety incidents.",
          ],
        },
      ]}
    >
      <DeleteAccountRequestForm />
    </PublicInfoPage>
  );
}
