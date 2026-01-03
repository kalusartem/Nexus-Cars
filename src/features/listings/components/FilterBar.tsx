import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";

type Filters = {
  search: string;
  make: string;
  maxPrice: number;
};

type Props = {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
};

export function FilterBar({ filters, setFilters }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["listing-makes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("make")
        .eq("is_active", true);

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 10,
  });

  const makes = useMemo(() => {
    const uniq = new Set<string>();
    for (const row of data ?? []) {
      const make = (row as any).make as string | null;
      if (make && make.trim()) uniq.add(make.trim());
    }
    return Array.from(uniq).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const DEFAULT_MAX_PRICE = Number.MAX_SAFE_INTEGER;
  const UI_MAX_PRICE = 200000;

  const sliderValue =
    filters.maxPrice === DEFAULT_MAX_PRICE ? UI_MAX_PRICE : filters.maxPrice;

  const maxPriceLabel =
    filters.maxPrice === DEFAULT_MAX_PRICE
      ? "No max"
      : new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(filters.maxPrice);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800 flex flex-wrap gap-4 items-center">
        <input
          type="text"
          placeholder="Search make or model..."
          className="bg-slate-800 border-none rounded-lg px-4 py-2 text-white flex-1 min-w-[200px] focus:ring-2 focus:ring-blue-500"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />

        <div className="relative inline-block">
          <select
            className="appearance-none bg-slate-800 border-none rounded-lg px-4 py-2 pr-10 text-white min-w-[150px] disabled:opacity-60"
            value={filters.make}
            onChange={(e) => setFilters({ ...filters, make: e.target.value })}
            disabled={isLoading || isError}
          >
            <option value="">
              {isLoading
                ? "Loading makes…"
                : isError
                  ? "Makes unavailable"
                  : "All Makes"}
            </option>

            {!isLoading &&
              !isError &&
              makes.map((make) => (
                <option key={make} value={make}>
                  {make}
                </option>
              ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white">
            ▼
          </span>
        </div>

        <div className="flex flex-col flex-1 min-w-[200px]">
          <div className="text-sm text-slate-300 mb-1">
            Max Price: {maxPriceLabel}
          </div>
          <input
            type="range"
            min={10000}
            max={UI_MAX_PRICE}
            step={1000}
            value={sliderValue}
            onChange={(e) => {
              const v = Number(e.target.value);
              setFilters((prev) => ({
                ...prev,
                maxPrice: v >= UI_MAX_PRICE ? DEFAULT_MAX_PRICE : v,
              }));
            }}
          />
        </div>
      </div>
    </div>
  );
}
