import OrderTrackingClient from "./OrderTrackingClient";

type SearchParams = Record<string, string | string[] | undefined>;

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ orderId }, query] = await Promise.all([params, searchParams]);

  return (
    <OrderTrackingClient
      orderId={orderId}
      initialCityId={pickSingle(query.cityId).trim()}
    />
  );
}
