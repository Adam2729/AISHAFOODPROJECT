import type { Metadata } from "next";
import PublicInfoPage from "../_components/PublicInfoPage";

export const metadata: Metadata = {
  title: "Terms of Service | OranjeEats",
  description:
    "Review the customer, merchant, and driver terms that govern use of the OranjeEats marketplace and delivery platform.",
};

export default function TermsPage() {
  return (
    <PublicInfoPage
      eyebrow="Terms"
      title="OranjeEats Terms of Service"
      description="These terms govern customer ordering, merchant operations, driver participation, cancellations, refunds, and operational responsibilities across the OranjeEats platform."
      sections={[
        {
          title: "Use of the platform",
          body: [
            "OranjeEats provides a marketplace that connects customers, merchants, and drivers for ordering, delivery, support, and marketplace operations.",
            "By using the platform, you agree to provide accurate information, use the service lawfully, and avoid fraudulent, abusive, or unsafe activity.",
          ],
        },
        {
          title: "Customer responsibilities",
          bullets: [
            "Provide accurate contact details, delivery address, and reachable phone information.",
            "Use valid payment methods and confirm cash or third-party payment obligations honestly.",
            "Remain available for delivery, OTP verification, support follow-up, or issue resolution when needed.",
          ],
        },
        {
          title: "Merchant responsibilities",
          bullets: [
            "Keep business, menu, pricing, opening hours, and availability accurate.",
            "Prepare orders safely and on time, and update order status honestly.",
            "Use approved payout information, support the reconciliation process, and respect marketplace service standards.",
          ],
        },
        {
          title: "Driver responsibilities",
          bullets: [
            "Use accurate account details, maintain lawful delivery conduct, and keep active-delivery status updates truthful.",
            "Handle customer orders, delivery proof, and payment collection steps according to platform policy.",
            "Avoid misuse of merchant, customer, or operational contact information.",
          ],
        },
        {
          title: "Delivery models",
          body: [
            "OranjeEats supports both platform_driver deliveries and merchant self-delivery. Some orders are fulfilled by OranjeEats-approved drivers, while others are handled directly by the merchant.",
            "Operational visibility, ETA, and support workflows may differ depending on the selected delivery mode.",
          ],
        },
        {
          title: "Payments, refunds, and cancellations",
          body: [
            "Orders may use cash, local mobile money options, or third-party payment providers. Payment confirmation, refund review, and cancellation handling may depend on provider-side status and operational evidence.",
            "Merchants and operations teams may cancel orders for valid operational reasons such as item unavailability, payment issues, or safety concerns. Refunds are assessed according to payment state, order progress, and provider constraints.",
          ],
        },
        {
          title: "Limitation of liability",
          body: [
            "OranjeEats works to provide a reliable marketplace, but the platform cannot guarantee uninterrupted availability, exact ETA outcomes, or merchant inventory accuracy at all times.",
            "To the extent permitted by law, OranjeEats is not liable for indirect, incidental, or consequential losses arising from delayed deliveries, third-party payment failures, merchant stock issues, or connectivity disruptions.",
          ],
        },
      ]}
    />
  );
}
