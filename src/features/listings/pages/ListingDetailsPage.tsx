// src/features/listings/pages/ListingDetailsPage.tsx
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { fetchIsAdmin } from "../../../lib/admin";

type ListingImage = {
  bucket: string;
  path: string;
  position: number;
};

type ListingRow = {
  id: string;
  seller_id: string;
  make: string;
  model: string;
  year: number | null;
  price: number | string;
  mileage: number | null;
  fuel_type: string | null;
  transmission: string | null;
  description: string | null;
  location: string | null;
  created_at: string | null;
  listing_images?: ListingImage[] | null;
};

async function fetchListing(id: string) {
  const { data, error } = await supabase
    .from("listings")
    .select("*, listing_images(bucket, path, position)")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as ListingRow;
}

function publicUrl(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

function formatMileage(mileage: any) {
  if (typeof mileage === "number") return `${mileage.toLocaleString()} mi`;
  if (mileage === null || mileage === undefined) return "—";
  const n = Number(mileage);
  return Number.isFinite(n) ? `${n.toLocaleString()} mi` : String(mileage);
}

function formatDate(date: any) {
  if (!date) return "—";
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function ListingDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["listing", id],
    queryFn: () => fetchListing(id!),
    enabled: !!id,
  });

  const { data: userId } = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) return null;
      return data?.user?.id ?? null;
    },
    staleTime: 1000 * 30,
  });

  if (!id) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        Missing listing id.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        Loading listing…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <div className="text-red-300">
          Failed to load listing: {(error as any)?.message ?? "Unknown error"}
        </div>
        <Link to="/listings" className="text-blue-400 hover:underline">
          Back to listings
        </Link>
      </div>
    );
  }

  const row = data;
  if (!row) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        Listing not found.{" "}
        <Link to="/listings" className="text-blue-400 hover:underline">
          Back to listings
        </Link>
      </div>
    );
  }

  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin", userId],
    queryFn: () => fetchIsAdmin(userId ?? null),
    enabled: !!userId,
    staleTime: 1000 * 60,
  });

  const { data: isFav } = useQuery({
    queryKey: ["favorite", userId, row.id],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("favorites")
        .select("id")
        .eq("user_id", userId!)
        .eq("listing_id", row.id)
        .maybeSingle();
      if (error) throw error;
      return !!data?.id;
    },
    staleTime: 1000 * 10,
  });

  const toggleFavorite = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Please log in to save favorites.");
      if (isFav) {
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", userId)
          .eq("listing_id", row.id);
        if (error) throw error;
        return false;
      }
      const { error } = await supabase
        .from("favorites")
        .insert({ user_id: userId, listing_id: row.id });
      if (error) throw error;
      return true;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["favorite", userId, row.id] });
      await qc.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

  const canEdit = !!userId && (userId === row.seller_id || !!isAdmin);

  const images = (row.listing_images ?? [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const cover = images[0];
  const coverUrl = cover ? publicUrl(cover.bucket, cover.path) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Link to="/listings" className="text-slate-300 hover:text-white">
          ← Back to listings
        </Link>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold">
                {row.make} {row.model} {row.year ? `(${row.year})` : ""}
              </h1>
              <p className="text-slate-400 mt-1 text-sm">
                Posted: {formatDate(row.created_at)}
              </p>
            </div>

            <div className="text-2xl font-bold">
              ${Number(row.price).toLocaleString()}
            </div>
          </div>

          {/* Cover */}
          <div className="mt-6">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={`${row.make} ${row.model} cover`}
                className="w-full h-80 object-cover rounded-xl border border-slate-800"
              />
            ) : (
              <div className="w-full h-80 rounded-xl border border-slate-800 bg-slate-950/40 flex items-center justify-center text-slate-500">
                No images available
              </div>
            )}
          </div>

          {/* Gallery */}
          {images.length > 1 ? (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {images.slice(1).map((img, idx) => {
                const url = publicUrl(img.bucket, img.path);
                return (
                  <img
                    key={`${img.path}-${idx}`}
                    src={url}
                    alt={`${row.make} ${row.model} ${idx + 2}`}
                    className="w-full h-40 object-cover rounded-xl border border-slate-800"
                    loading="lazy"
                  />
                );
              })}
            </div>
          ) : null}

          {/* Specs */}
          <div className="mt-6 grid sm:grid-cols-2 gap-4">
            <Spec label="Mileage" value={formatMileage(row.mileage)} />
            <Spec label="Transmission" value={row.transmission ?? "—"} />
            <Spec label="Fuel" value={row.fuel_type ?? "—"} />
            <Spec label="Location" value={row.location ?? "—"} />
          </div>

          {/* Description */}
          <div className="mt-6">
            <h2 className="font-semibold">Description</h2>
            <p className="text-slate-300 mt-2 whitespace-pre-line">
              {row.description ?? "No description provided."}
            </p>
          </div>

          {/* CTAs */}
          <div className="mt-6 flex gap-3 flex-wrap">
            <button
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
              disabled={!userId || toggleFavorite.isPending}
              onClick={() => toggleFavorite.mutate()}
              title={userId ? "Save to favorites" : "Log in to save"}
            >
              {isFav ? "Saved ❤️" : "Save"}
            </button>
            <button className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700">
              Contact seller (next)
            </button>

            {canEdit ? (
              <Link
                to={`/listings/${row.id}/edit`}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700"
              >
                Edit
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-100 mt-1">{value}</div>
    </div>
  );
}
