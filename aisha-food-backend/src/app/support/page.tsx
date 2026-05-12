import type { Metadata } from "next";
import PublicInfoPage from "../_components/PublicInfoPage";

export const metadata: Metadata = {
  title: "Support | OranjeEats",
  description:
    "Find customer, merchant, driver, and payment support contacts for OranjeEats launch operations and order issue handling.",
};

export default function SupportPage() {
  return (
    <PublicInfoPage
      eyebrow="Support"
      title="OranjeEats Support"
      description="Use this page to contact the right OranjeEats support channel for customer orders, merchant operations, driver issues, and payment or refund follow-up."
      sections={[
        {
          title: "Customer support",
          body: [
            "For order updates, delivery delays, missing items, refund requests, or account issues, contact support@oranjeeats.com.",
            "WhatsApp placeholder: +223 00 00 00 00",
          ],
        },
        {
          title: "Restaurant and merchant support",
          body: [
            "For onboarding, menu updates, logo or product image issues, settlement questions, or operational escalations, contact support@oranjeeats.com.",
            "WhatsApp placeholder: +223 00 00 00 00",
          ],
        },
        {
          title: "Driver support",
          body: [
            "For driver account approval, dispatch issues, payout requests, proof-of-delivery questions, or app login problems, contact support@oranjeeats.com.",
            "WhatsApp placeholder: +223 00 00 00 00",
          ],
        },
        {
          title: "Payment and order issues",
          body: [
            "If an order was charged but not confirmed, or a payment provider status looks incorrect, contact support with the order reference, phone number, and payment method used.",
            "Payments may be handled by external providers, so resolution timing can depend on provider confirmation and reconciliation records.",
          ],
        },
      ]}
    />
  );
}
