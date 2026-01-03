// src/features/listings/pages/EditListingPage.tsx
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { ListingForm } from "../components/ListingForm";
import type { ListingRow } from "../components/ListingForm";
import { fetchAuthUser } from "../../../lib/auth";
import { fetchIsAdmin } from "../../../lib/admin";

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

  if (!id) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <div className="text-red-300">Missing listing id.</div>
        <Link to="/listings" className="text-blue-400 hover:underline">
          Back to listings
        </Link>
      </div>
    );
  }

  // 1) Load auth user
  const {
    data: user,
    isLoading: isAuthLoading,
    isError: isAuthError,
    error: authError,
  } = useQuery({
    queryKey: ["auth-user"],
    queryFn: fetchAuthUser,
    staleTime: 1000 * 30,
  });

  const userId = user?.id ?? null;

  // Auth loading / error states
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        Loading session…
      </div>
    );
  }

  if (isAuthError) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <div className="text-red-300">
          Auth error: {(authError as any)?.message ?? "Unknown error"}
        </div>
        <Link to="/listings" className="text-blue-400 hover:underline">
          Back to listings
        </Link>
      </div>
    );
  }

  // Require login for edit page
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

  // 2) Load admin flag (only once user is known)
  const {
    data: isAdmin,
    isLoading: isAdminLoading,
    isError: isAdminError,
  } = useQuery({
    queryKey: ["is-admin", userId],
    enabled: !!userId,
    queryFn: () => fetchIsAdmin(userId),
    staleTime: 1000 * 30,
  });

  // 3) Load the listing
  const {
    data: listing,
    isLoading: isListingLoading,
    isError: isListingError,
    error: listingError,
  } = useQuery({
    queryKey: ["listing-edit", id],
    queryFn: () => fetchListing(id),
    enabled: !!id && !!userId,
  });

  if (isListingLoading || isAdminLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        Loading listing…
      </div>
    );
  }

  if (isListingError) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <div className="text-red-300">
          Failed to load listing:{" "}
          {(listingError as any)?.message ?? "Unknown error"}
        </div>
        <Link to="/listings" className="text-blue-400 hover:underline">
          Back to listings
        </Link>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <div className="text-red-300">Listing not found.</div>
        <Link to="/listings" className="text-blue-400 hover:underline">
          Back to listings
        </Link>
      </div>
    );
  }

  // If admin lookup errored, default to non-admin (but don't crash)
  const admin = !!isAdmin && !isAdminError;

  const canEdit = admin || listing.seller_id === userId;

  if (!canEdit) {
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
      <div className="max-w-4xl mx-auto px-6 pt-8">
        <Link
          to={`/listings/${id}`}
          className="text-slate-300 hover:text-white"
        >
          ← Back to listing
        </Link>

        <button
          className="ml-4 text-sm text-slate-300 hover:text-white"
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
