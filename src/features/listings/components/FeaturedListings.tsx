// src/features/listings/components/FeaturedListings.tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "../../../lib/supabase";

type Filters = {
  search: string;
  make: string;
  maxPrice: number;
  zip: string;
  radiusMiles: number;
};

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

type Props = {
  filters: Filters;
};

function publicUrl(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function fetchFeatured(filters: Filters) {
  const DEFAULT_MAX_PRICE = Number.MAX_SAFE_INTEGER;
  let q = supabase
    .from("listings")
    .select("*, listing_images(bucket, path, position)")
    .eq("is_active", true)
    .eq("is_featured", true)
    .order("created_at", { ascending: false })
    .limit(6);

  const term = filters.search.trim();
  if (term) {
    q = q.or(`make.ilike.%${term}%,model.ilike.%${term}%`);
  }

  if (filters.make) q = q.eq("make", filters.make);
  if (filters.maxPrice !== DEFAULT_MAX_PRICE) q = q.lte("price", filters.maxPrice);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []) as ListingRow[];
}

export function FeaturedListings({ filters }: Props) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["featured-listings", filters],
    queryFn: () => fetchFeatured(filters),
    staleTime: 1000 * 20,
  });

  return (
    <section className="max-w-7xl mx-auto px-6 pb-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Featured Listings</h2>

        <Link
          to="/listings"
          className="text-blue-400 hover:text-blue-300 font-medium"
        >
          View All →
        </Link>
      </div>

      {isLoading ? (
        <div className="text-slate-300">Loading featured listings…</div>
      ) : isError ? (
        <div className="text-red-300">
          Failed to load listings: {(error as any)?.message ?? "Unknown error"}
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-slate-300">
          No featured listings match your filters.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data ?? []).map((row) => {
            const images = (row.listing_images ?? [])
              .slice()
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
            const cover = images[0];
            const coverUrl = cover ? publicUrl(cover.bucket, cover.path) : null;

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
    </section>
  );
}
