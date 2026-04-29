"use client";

type CityOption = {
  _id: string;
  code?: string;
  slug?: string;
  name?: string;
};

type DriverPayoutsFiltersProps = {
  cityId: string;
  weekKey: string;
  status: "pending" | "paid";
  driverQuery: string;
  cities: CityOption[];
  loading?: boolean;
  onChangeCityId: (value: string) => void;
  onChangeWeekKey: (value: string) => void;
  onChangeStatus: (value: "pending" | "paid") => void;
  onChangeDriverQuery: (value: string) => void;
  onRefresh: () => void;
};

export default function DriverPayoutsFilters({
  cityId,
  weekKey,
  status,
  driverQuery,
  cities,
  loading = false,
  onChangeCityId,
  onChangeWeekKey,
  onChangeStatus,
  onChangeDriverQuery,
  onRefresh,
}: DriverPayoutsFiltersProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="grid gap-3 md:grid-cols-5">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">City</span>
          <select
            value={cityId}
            onChange={(event) => onChangeCityId(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2"
          >
            {cities.map((city) => (
              <option key={city._id} value={city._id}>
                {city.name} ({String(city.code || city.slug || "CITY").toUpperCase()})
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Week Key</span>
          <input
            value={weekKey}
            onChange={(event) => onChangeWeekKey(event.target.value)}
            placeholder="YYYY-Www"
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Status</span>
          <select
            value={status}
            onChange={(event) => onChangeStatus(event.target.value === "paid" ? "paid" : "pending")}
            className="w-full rounded border border-slate-300 px-3 py-2"
          >
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Driver Search</span>
          <input
            value={driverQuery}
            onChange={(event) => onChangeDriverQuery(event.target.value)}
            placeholder="driverRef or driverId"
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>

        <div className="flex items-end">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>
    </section>
  );
}

