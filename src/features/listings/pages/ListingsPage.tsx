// src/features/listings/pages/ListingsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { FilterBar } from "../components/FilterBar";
import { geocodeZip } from "../../../lib/location";

type Filters = {
  search: string;
  make: string;
  maxPrice: number; // DEFAULT_MAX_PRICE means "no limit"
  zip: string;
  radiusMiles: number; // 0 = ignore
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

// Browse page requirement: paginate at 25
const PAGE_SIZE = 25;

// "Unlimited" sentinel for max price
const DEFAULT_MAX_PRICE = Number.MAX_SAFE_INTEGER;

function toNumber(value: string | null, fallback: number) {
  if (value === null || value === undefined || value === "") return fallback;
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
}): Promise<{ rows: ListingRow[]; count: number }> {
  const { filters, sort, page } = args;

  // Location-aware search uses a lightweight RPC to get ordered IDs within radius,
  // then pulls the listing rows + images in a second query.
  const useRadius = !!filters.zip.trim() && (filters.radiusMiles ?? 0) > 0;
  if (useRadius) {
    const ll = await geocodeZip(filters.zip);
    if (!ll) {
      // If ZIP can't be geocoded, fall back to normal search (no radius).
    } else {
      const { data: idRows, error: idErr } = await supabase.rpc(
        "search_listing_ids_within_radius",
        {
          p_lat: ll.lat,
          p_lng: ll.lng,
          p_radius_miles: filters.radiusMiles,
          p_search: filters.search?.trim() || null,
          p_make: filters.make || null,
          p_max_price:
            filters.maxPrice === DEFAULT_MAX_PRICE ? null : filters.maxPrice,
          p_sort: sort,
          p_page: page,
          p_page_size: PAGE_SIZE,
        },
      );

      if (idErr) {
        // If the RPC isn't deployed yet, we fall back gracefully.
      } else {
        const ids = (idRows ?? []).map((r: any) => r.listing_id as string);
        const totalCount =
          (idRows?.[0]?.total_count as number | undefined) ?? 0;
        if (!ids.length) return { rows: [], count: totalCount };

        const { data, error } = await supabase
          .from("listings")
          .select("*, listing_images(bucket, path, position)", { count: "exact" })
          .in("id", ids);
        if (error) throw error;

        const order = new Map(ids.map((id, idx) => [id, idx]));
        const rows = ((data ?? []) as ListingRow[]).slice().sort((a, b) => {
          return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
        });

        return { rows, count: totalCount };
      }
    }
  }

  let q = supabase
    .from("listings")
    .select("*, listing_images(bucket, path, position)", { count: "exact" })
    .eq("is_active", true);

  const term = filters.search.trim();
  if (term) {
    q = q.or(`make.ilike.%${term}%,model.ilike.%${term}%`);
  }

  if (filters.make) q = q.eq("make", filters.make);

  // Only apply max price filter when user has set a limit
  if (filters.maxPrice !== DEFAULT_MAX_PRICE) {
    q = q.lte("price", filters.maxPrice);
  }

  if (sort === "newest") q = q.order("created_at", { ascending: false });
  if (sort === "price_asc") q = q.order("price", { ascending: true });
  if (sort === "price_desc") q = q.order("price", { ascending: false });

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  q = q.range(from, to);

  const { data, error, count } = await q;
  if (error) throw error;

  return { rows: (data ?? []) as ListingRow[], count: count ?? 0 };
}

async function fetchUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data?.user?.id ?? null;
}

async function fetchFavoritesForListingIds(
  userId: string,
  listingIds: string[],
): Promise<Set<string>> {
  if (!listingIds.length) return new Set();

  const { data, error } = await supabase
    .from("favorites")
    .select("listing_id")
    .eq("user_id", userId)
    .in("listing_id", listingIds);

  if (error) throw error;
  return new Set((data ?? []).map((r: any) => r.listing_id as string));
}

export function ListingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const urlFilters = useMemo<Filters>(() => {
    const search = searchParams.get("q") ?? "";
    const make = searchParams.get("make") ?? "";
    const zip = searchParams.get("zip") ?? "";
    const radiusMiles = clamp(toNumber(searchParams.get("radius"), 0), 0, 500);

    // If maxPrice is missing in URL => unlimited
    const maxPrice = clamp(
      toNumber(searchParams.get("maxPrice"), DEFAULT_MAX_PRICE),
      0,
      DEFAULT_MAX_PRICE,
    );

    return { search, make, maxPrice, zip, radiusMiles };
  }, [searchParams]);

  const urlSort = (searchParams.get("sort") as SortKey) ?? "newest";
  const urlPage = clamp(toNumber(searchParams.get("page"), 1), 1, 1_000_000);

  const [filters, setFilters] = useState<Filters>(urlFilters);
  const [sort, setSort] = useState<SortKey>(urlSort);

  useEffect(() => setFilters(urlFilters), [urlFilters]);
  useEffect(() => setSort(urlSort), [urlSort]);

  // Push local state -> URL, reset page
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("page", "1");

    if (filters.search) next.set("q", filters.search);
    else next.delete("q");

    if (filters.make) next.set("make", filters.make);
    else next.delete("make");

    if (filters.zip) next.set("zip", filters.zip);
    else next.delete("zip");

    if (filters.radiusMiles && filters.radiusMiles > 0)
      next.set("radius", String(filters.radiusMiles));
    else next.delete("radius");

    // Only store maxPrice in URL if it's not "unlimited"
    if (filters.maxPrice !== DEFAULT_MAX_PRICE) {
      next.set("maxPrice", String(filters.maxPrice));
    } else {
      next.delete("maxPrice");
    }

    next.set("sort", sort);

    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.make, filters.zip, filters.radiusMiles, filters.maxPrice, sort]);

  const page = urlPage;

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["listings", filters, sort, page],
    queryFn: () => fetchListings({ filters, sort, page }),
    placeholderData: (prev) => prev,
    staleTime: 1000 * 15,
  });

  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const listingIds = useMemo(() => (data?.rows ?? []).map((r) => r.id), [data]);

  const { data: userId } = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: fetchUserId,
    staleTime: 1000 * 30,
  });

  const favKey = useMemo(
    () => ["favorites-for-page", userId, listingIds.join("|")] as const,
    [userId, listingIds],
  );

  const { data: favSet } = useQuery({
    queryKey: favKey,
    enabled: !!userId && listingIds.length > 0,
    queryFn: () => fetchFavoritesForListingIds(userId!, listingIds),
    staleTime: 1000 * 10,
  });

  const toggleFavorite = useMutation({
    mutationFn: async (listingId: string) => {
      if (!userId) throw new Error("Please log in to save favorites.");

      const isFav = favSet?.has(listingId) ?? false;

      if (isFav) {
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", userId)
          .eq("listing_id", listingId);

        if (error) throw error;
        return { listingId, next: false };
      } else {
        const { error } = await supabase
          .from("favorites")
          .insert({ user_id: userId, listing_id: listingId });

        if (error) throw error;
        return { listingId, next: true };
      }
    },
    onMutate: async (listingId) => {
      await qc.cancelQueries({ queryKey: favKey });

      const prev = qc.getQueryData<Set<string>>(favKey);
      const next = new Set<string>(prev ?? favSet ?? new Set());

      if (next.has(listingId)) next.delete(listingId);
      else next.add(listingId);

      qc.setQueryData(favKey, next);
      return { prev };
    },
    onError: (_err, _listingId, ctx) => {
      if (ctx?.prev) qc.setQueryData(favKey, ctx.prev);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

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
              Filter, sort, and save your favorites.
            </p>
          </div>

          <div className="flex items-center gap-3">
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
                  // Reset all filters to defaults (including maxPrice unlimited)
                  setSearchParams(
                    new URLSearchParams({
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
                {(data?.rows ?? []).map((row: ListingRow) => {
                  const images = (row.listing_images ?? [])
                    .slice()
                    .sort(
                      (a: ListingImage, b: ListingImage) =>
                        (a.position ?? 0) - (b.position ?? 0),
                    );

                  const cover = images[0];
                  const coverUrl = cover
                    ? publicUrl(cover.bucket, cover.path)
                    : null;

                  const isFav = !!userId && (favSet?.has(row.id) ?? false);

                  return (
                    <Link
                      key={row.id}
                      to={`/listings/${row.id}`}
                      className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 hover:border-slate-700 transition relative"
                    >
                      <button
                        type="button"
                        className="absolute top-3 right-3 z-10 rounded-full bg-black/50 hover:bg-black/70 px-3 py-2 text-sm disabled:opacity-50"
                        title={
                          userId
                            ? isFav
                              ? "Unsave"
                              : "Save"
                            : "Log in to save"
                        }
                        disabled={!userId || toggleFavorite.isPending}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleFavorite.mutate(row.id);
                        }}
                      >
                        {isFav ? "❤️" : "🤍"}
                      </button>

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
