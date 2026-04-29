import RestaurantsClient from "./RestaurantsClient";

type SearchParams = Record<string, string | string[] | undefined>;

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function RestaurantsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <RestaurantsClient
      initialCityId={pickSingle(params.cityId).trim()}
      initialQuery={pickSingle(params.q).trim()}
    />
  );
}
