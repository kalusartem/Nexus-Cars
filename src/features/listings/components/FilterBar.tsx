import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { geocodeZip, getZipFromIp } from "../../../lib/location";

type Filters = {
  search: string;
  make: string;
  maxPrice: number;
  zip: string;
  radiusMiles: number; // 0 = ignore
};

type Props = {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
};

export function FilterBar({ filters, setFilters }: Props) {
  const [zipStatus, setZipStatus] = useState<"idle" | "loading" | "ready">(
    "idle",
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ["listing-makes"],
    queryFn: async () => {
      // Prefer a dedicated brands table if present.
      // brands: id, name
      const brands = await supabase.from("brands").select("name");
      if (!brands.error && brands.data?.length) return brands.data;

      // Fallback: infer from listings
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
      const make = ((row as any).name ?? (row as any).make) as string | null;
      if (make && make.trim()) uniq.add(make.trim());
    }
    return Array.from(uniq).sort((a, b) => a.localeCompare(b));
  }, [data]);

  // Default ZIP by IP (best effort) the first time the filter bar mounts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (filters.zip?.trim()) return;
      setZipStatus("loading");
      const ipZip = await getZipFromIp();
      if (cancelled) return;
      if (ipZip) {
        setFilters((prev) => ({ ...prev, zip: ipZip }));
      }
      setZipStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        {/* Location filter */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder={zipStatus === "loading" ? "Detecting ZIP…" : "ZIP"}
            className="bg-slate-800 border-none rounded-lg px-4 py-2 text-white w-[120px] focus:ring-2 focus:ring-blue-500"
            value={filters.zip}
            onChange={(e) => setFilters({ ...filters, zip: e.target.value })}
          />

          <select
            className="bg-slate-800 border-none rounded-lg px-4 py-2 text-white"
            value={String(filters.radiusMiles)}
            onChange={(e) =>
              setFilters({ ...filters, radiusMiles: Number(e.target.value) })
            }
            title="Search radius"
          >
            <option value="0">Any distance</option>
            <option value="10">10 mi</option>
            <option value="25">25 mi</option>
            <option value="50">50 mi</option>
            <option value="100">100 mi</option>
          </select>
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

      {/* Background geocode hint to keep UI snappy */}
      {/* When ZIP changes, we pre-warm the geocode cache by calling the endpoint once. */}
      <ZipPrewarm zip={filters.zip} />
    </div>
  );
}

function ZipPrewarm({ zip }: { zip: string }) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const z = zip.trim();
      if (!z) return;
      // fire-and-forget; consumer queries will geocode again if needed
      await geocodeZip(z);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [zip]);
  return null;
}
