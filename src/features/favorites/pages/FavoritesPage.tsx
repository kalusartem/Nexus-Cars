// src/features/favorites/pages/FavoritesPage.tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "../../../lib/supabase";

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

type FavoriteRow = {
  id: string;
  listing_id: string;
  created_at: string;
  listings: ListingRow;
};

function publicUrl(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function fetchFavorites() {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  if (!userRes?.user)
    throw new Error("You must be logged in to view favorites.");

  const userId = userRes.user.id;

  // Requires a favorites table:
  // favorites: id, user_id, listing_id, created_at
  // with FK listing_id -> listings.id
  // and FK/relationship from favorites -> listings
  const { data, error } = await supabase
    .from("favorites")
    .select(
      `
      id,
      listing_id,
      created_at,
      listings (
        id,
        make,
        model,
        year,
        price,
        mileage,
        created_at,
        listing_images ( bucket, path, position )
      )
    `,
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // Supabase returns nested listings object; cast for TS convenience
  return (data ?? []) as unknown as FavoriteRow[];
}

export function FavoritesPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["favorites"],
    queryFn: fetchFavorites,
    staleTime: 1000 * 20,
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Saved Cars</h1>
            <p className="text-slate-400 text-sm mt-1">
              Your favorite listings in one place.
            </p>
          </div>

          <Link
            to="/listings"
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm"
          >
            Browse
          </Link>
        </div>

        {isLoading ? (
          <div className="mt-6 text-slate-300">Loading favorites…</div>
        ) : isError ? (
          <div className="mt-6 text-red-300">
            {(error as any)?.message ?? "Failed to load favorites."}
          </div>
        ) : (data?.length ?? 0) === 0 ? (
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-slate-300">
            No favorites yet. Go to{" "}
            <Link to="/listings" className="text-blue-400 hover:underline">
              Browse
            </Link>{" "}
            and tap the heart to save cars.
          </div>
        ) : (
          <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(data ?? []).map((fav) => {
              const row = fav.listings;
              const images = (row.listing_images ?? [])
                .slice()
                .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
              const cover = images[0];
              const coverUrl = cover
                ? publicUrl(cover.bucket, cover.path)
                : null;

              return (
                <Link
                  key={fav.id}
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
      </div>
    </div>
  );
}
