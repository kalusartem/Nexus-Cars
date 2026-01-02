// src/features/listings/pages/ListingsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { FilterBar } from "../components/FilterBar";

type Filters = {
  search: string;
  make: string;
  maxPrice: number;
};

type SortKey = "newest" | "price_asc" | "price_desc";

type ListingImage = {
  bucket: string;
  path: string;
  position: number;
};

type ListingRow = {
  id: string;
  make: string;
  model: string;
  year: number | null;
  price: number | string;
  mileage: number | null;
  created_at: string | null;
  listing_images?: ListingImage[] | null;
};

const PAGE_SIZE = 12;

function toNumber(value: string | null, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function publicUrl(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function fetchListings(args: {
  filters: Filters;
  sort: SortKey;
  page: number;
}) {
  const { filters, sort, page } = args;

  let q = supabase
    .from("listings")
    .select("*, listing_images(bucket, path, position)", { count: "exact" })
    .eq("is_active", true);

  const term = filters.search.trim();
  if (term) {
    // Adjust if you have more fields (title, description, etc.)
    q = q.or(`make.ilike.%${term}%,model.ilike.%${term}%`);
  }

  if (filters.make) q = q.eq("make", filters.make);
  if (filters.maxPrice) q = q.lte("price", filters.maxPrice);

  // Sorting
  if (sort === "newest") q = q.order("created_at", { ascending: false });
  if (sort === "price_asc") q = q.order("price", { ascending: true });
  if (sort === "price_desc") q = q.order("price", { ascending: false });

  // Pagination
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  q = q.range(from, to);

  const { data, error, count } = await q;
  if (error) throw error;

  return { rows: (data ?? []) as ListingRow[], count: count ?? 0 };
}

export function ListingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read URL -> defaults
  const urlFilters = useMemo<Filters>(() => {
    const search = searchParams.get("q") ?? "";
    const make = searchParams.get("make") ?? "";
    const maxPrice = clamp(
      toNumber(searchParams.get("maxPrice"), 200000),
      10000,
      200000,
    );
    return { search, make, maxPrice };
  }, [searchParams]);

  const urlSort = (searchParams.get("sort") as SortKey) ?? "newest";
  const urlPage = clamp(toNumber(searchParams.get("page"), 1), 1, 1_000_000);

  const [filters, setFilters] = useState<Filters>(urlFilters);
  const [sort, setSort] = useState<SortKey>(urlSort);

  // Sync local state with URL changes
  useEffect(() => setFilters(urlFilters), [urlFilters]);
  useEffect(() => setSort(urlSort), [urlSort]);

  // Push filters/sort -> URL, reset page
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("page", "1");

    if (filters.search) next.set("q", filters.search);
    else next.delete("q");

    if (filters.make) next.set("make", filters.make);
    else next.delete("make");

    next.set("maxPrice", String(filters.maxPrice));
    next.set("sort", sort);

    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.make, filters.maxPrice, sort]);

  const page = urlPage;

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["listings", filters, sort, page],
    queryFn: () => fetchListings({ filters, sort, page }),
    keepPreviousData: true,
    staleTime: 1000 * 15,
  });

  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const goToPage = (p: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(clamp(p, 1, totalPages)));
    setSearchParams(next);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-6 pt-8">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Browse Listings</h1>
            <p className="text-slate-400 text-sm mt-1">
              Filter, sort, and share your search.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/sell"
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm"
            >
              Sell
            </Link>

            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-300">Sort</label>
              <select
                className="bg-slate-800 rounded-lg px-3 py-2 text-white"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="newest">Newest</option>
                <option value="price_asc">Price: Low → High</option>
                <option value="price_desc">Price: High → Low</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <FilterBar filters={filters} setFilters={setFilters} />

      <div className="max-w-7xl mx-auto px-6 pb-12">
        {isLoading && <div className="text-slate-300">Loading listings…</div>}

        {isError && (
          <div className="text-red-300">
            Failed to load listings:{" "}
            {(error as any)?.message ?? "Unknown error"}
          </div>
        )}

        {!isLoading && !isError && (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-slate-400">
                Showing {data?.rows.length ?? 0} of {total} results
                {isFetching ? <span className="ml-2">• Updating…</span> : null}
              </div>

              <button
                className="text-sm text-slate-300 hover:text-white"
                onClick={() => {
                  setSearchParams(
                    new URLSearchParams({
                      maxPrice: "200000",
                      sort: "newest",
                      page: "1",
                    }),
                  );
                }}
              >
                Clear filters
              </button>
            </div>

            {(data?.rows?.length ?? 0) === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-slate-300">
                No listings match your filters. Try widening your search.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(data?.rows ?? []).map((row) => {
                  const images = (row.listing_images ?? [])
                    .slice()
                    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
                  const cover = images[0];
                  const coverUrl = cover
                    ? publicUrl(cover.bucket, cover.path)
                    : null;

                  return (
                    <Link
                      key={row.id}
                      to={`/listings/${row.id}`}
                      className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 hover:border-slate-700 transition"
                    >
                      {coverUrl ? (
                        <img
                          src={coverUrl}
                          alt={`${row.make} ${row.model}`}
                          className="w-full h-40 object-cover rounded-xl border border-slate-800 mb-3"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-40 rounded-xl border border-slate-800 bg-slate-950/40 mb-3 flex items-center justify-center text-slate-500">
                          No image
                        </div>
                      )}

                      <div className="font-semibold">
                        {row.make} {row.model}
                      </div>

                      <div className="text-slate-300 mt-1">
                        ${Number(row.price).toLocaleString()}
                      </div>

                      <div className="text-xs text-slate-400 mt-2">
                        {row.year ?? "—"} •{" "}
                        {typeof row.mileage === "number"
                          ? `${row.mileage.toLocaleString()} mi`
                          : (row.mileage ?? "—")}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            <div className="flex items-center justify-between mt-8">
              <button
                className="px-4 py-2 rounded-lg bg-slate-800 disabled:opacity-50"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                Prev
              </button>

              <div className="text-sm text-slate-300">
                Page {page} / {totalPages}
              </div>

              <button
                className="px-4 py-2 rounded-lg bg-slate-800 disabled:opacity-50"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
