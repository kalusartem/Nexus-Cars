import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { ListingForm, ListingRow } from "../components/ListingForm";

async function fetchListing(id: string) {
  const { data, error } = await supabase
    .from("listings")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as ListingRow;
}

export function EditListingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["listing-edit", id],
    queryFn: () => fetchListing(id!),
    enabled: !!id,
  });

  // Optional: ownership guard (recommended)
  const { data: userRes } = useQuery({
    queryKey: ["auth-user"],
    queryFn: async () => supabase.auth.getUser(),
    staleTime: 1000 * 30,
  });

  const userId = userRes?.data?.user?.id;

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

  const listing = data!;

  // If you want to require login to edit:
  if (!userId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <div className="text-slate-300">
          You need to be logged in to edit listings.
        </div>
        <Link to="/listings" className="text-blue-400 hover:underline">
          Back to listings
        </Link>
      </div>
    );
  }

  // Ownership check
  if (listing.seller_id !== userId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <div className="text-red-300">
          You don’t have permission to edit this listing.
        </div>
        <Link to={`/listings/${id}`} className="text-blue-400 hover:underline">
          View listing
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-4xl mx-auto px-6 pt-8 flex items-center justify-between gap-4 flex-wrap">
        <Link
          to={`/listings/${id}`}
          className="text-slate-300 hover:text-white"
        >
          ← Back to listing
        </Link>

        <button
          className="text-sm text-slate-300 hover:text-white"
          onClick={() => navigate("/listings")}
        >
          Browse
        </button>
      </div>

      <ListingForm
        mode="edit"
        listingId={id}
        initial={listing}
        showImages
        onSaved={() => {
          // optional: toast later
        }}
      />
    </div>
  );
}
