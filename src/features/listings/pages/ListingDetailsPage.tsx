import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";

async function fetchListing(id: string) {
  const { data, error } = await supabase
    .from("listings")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export function ListingDetailsPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["listing", id],
    queryFn: () => fetchListing(id!),
    enabled: !!id,
  });

  if (isLoading) return <div className="p-6 text-slate-300">Loading…</div>;
  if (isError)
    return (
      <div className="p-6 text-red-300">
        Failed to load listing: {(error as any)?.message ?? "Unknown error"}
      </div>
    );

  const row: any = data;

  const images: string[] = Array.isArray(row.image_urls) ? row.image_urls : [];

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
              <p className="text-slate-400 mt-1">
                Listing #{row.id?.toString().slice(0, 8)}
              </p>
            </div>

            <div className="text-2xl font-bold">
              ${Number(row.price).toLocaleString()}
            </div>
          </div>

          {/* Image placeholder (upgrade next) */}
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/40 h-64 flex items-center justify-center text-slate-500">
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {images.length ? (
                images.map((url, idx) => (
                  <img
                    key={url + idx}
                    src={url}
                    alt={`${row.make} ${row.model} ${idx + 1}`}
                    className="w-full h-64 object-cover rounded-xl border border-slate-800"
                  />
                ))
              ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 h-64 flex items-center justify-center text-slate-500 sm:col-span-2">
                  No images available
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 grid sm:grid-cols-2 gap-4">
            <Spec label="Mileage" value={formatMileage(row.mileage)} />
            <Spec label="Transmission" value={row.transmission ?? "—"} />
            <Spec label="Fuel" value={row.fuel_type ?? "—"} />
            <Spec label="Body" value={row.body_type ?? "—"} />
            <Spec label="Location" value={row.location ?? "—"} />
            <Spec label="Posted" value={formatDate(row.created_at)} />
          </div>

          <div className="mt-6">
            <h2 className="font-semibold">Description</h2>
            <p className="text-slate-300 mt-2 whitespace-pre-line">
              {row.description ?? "No description provided."}
            </p>
          </div>

          <div className="mt-6 flex gap-3 flex-wrap">
            <button className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500">
              Save (next)
            </button>
            <button className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700">
              Contact seller (next)
            </button>
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

function formatMileage(mileage: any) {
  if (typeof mileage === "number") return `${mileage.toLocaleString()} mi`;
  if (mileage === null || mileage === undefined) return "—";
  return String(mileage);
}

function formatDate(date: any) {
  if (!date) return "—";
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}
