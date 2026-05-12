import type { Metadata } from "next";
import PublicInfoPage from "../_components/PublicInfoPage";

export const metadata: Metadata = {
  title: "Privacy Policy | OranjeEats",
  description:
    "Read how OranjeEats collects, uses, stores, and protects customer, merchant, and driver data across marketplace operations.",
};

export default function PrivacyPage() {
  return (
    <PublicInfoPage
      eyebrow="Privacy"
      title="OranjeEats Privacy Policy"
      description="This policy explains what data OranjeEats collects, why it is used, how order and delivery operations depend on that data, and how users can request deletion or support."
      sections={[
        {
          title: "Information we collect",
          bullets: [
            "Account and contact details such as name, phone number, email address, and account role.",
            "Delivery data such as address, area, delivery notes, and location details needed to complete orders.",
            "Order history including order references, restaurant details, items purchased, delivery method, and payment status.",
            "Device and session data used to keep your account secure, verify recent order access on the same device, and troubleshoot service quality.",
            "Driver operational data including latest location, route progress, delivery proof, and dispatch status when a delivery is active.",
          ],
        },
        {
          title: "Why we use your data",
          body: [
            "OranjeEats uses personal data to create and manage orders, connect customers with merchants and drivers, process support requests, and keep the marketplace secure.",
            "We also use operational data to prevent fraud, resolve disputes, analyze service performance, improve dispatch quality, and maintain regulatory and accounting records.",
          ],
        },
        {
          title: "Driver location and live tracking",
          body: [
            "When a platform-driver order is active, driver location may be used to estimate pickup progress, customer ETA, and dispatch visibility for merchants, customers, and operations teams.",
            "Driver location is not used for unrelated background advertising. It is limited to delivery operations, safety, and service quality controls.",
          ],
        },
        {
          title: "Notifications and communications",
          body: [
            "We may send order updates, support messages, payout notices, and delivery alerts through in-app surfaces, WhatsApp-ready event flows, email, or other configured notification channels.",
            "Notification content is limited to operational updates, support follow-up, safety, and service continuity.",
          ],
        },
        {
          title: "Payments and third-party providers",
          body: [
            "Payments may be handled by third-party providers such as PayTech and other local payment methods. OranjeEats stores payment status, references, and limited reconciliation data needed to confirm orders and maintain finance records.",
            "Sensitive payment credentials are handled by the payment provider, not directly exposed in the mobile apps.",
          ],
        },
        {
          title: "Account deletion and retention",
          body: [
            "Users may request account deletion through the delete-account page or by contacting support@oranjeeats.com.",
            "We will delete or anonymize data that is no longer required, but some records may be retained for legal, tax, accounting, fraud prevention, chargeback handling, and dispute-resolution reasons.",
          ],
        },
        {
          title: "Contact",
          body: [
            "For privacy questions, access requests, correction requests, or deletion requests, contact support@oranjeeats.com.",
          ],
        },
      ]}
    />
  );
}
