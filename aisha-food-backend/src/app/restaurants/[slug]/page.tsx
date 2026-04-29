import RestaurantMenuClient from "./RestaurantMenuClient";

type SearchParams = Record<string, string | string[] | undefined>;

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function RestaurantPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);

  return (
    <RestaurantMenuClient
      slug={slug}
      initialCityId={pickSingle(query.cityId).trim()}
    />
  );
}
