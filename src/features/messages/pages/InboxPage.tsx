import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";

type ListingMini = {
  id: string;
  make: string;
  model: string;
  year: number | null;
  price: number | string;
};

type InquiryRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  message: string;
  created_at: string;
  listings?: ListingMini[] | null;
};

type Thread = {
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  last_message: string;
  last_at: string;
  listing: InquiryRow["listings"];
};

export function InboxPage() {
  const { data: userId } = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data?.user?.id ?? null;
    },
    staleTime: 30_000,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["inbox", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inquiries")
        .select(
          "id, listing_id, buyer_id, seller_id, message, created_at, listings(id, make, model, year, price)",
        )
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as InquiryRow[];
    },
  });

  if (!userId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <h1 className="text-2xl font-semibold">Messages</h1>
        <p className="mt-3 text-slate-300">Please sign in to view messages.</p>
        <Link
          className="mt-4 inline-block text-blue-400 hover:underline"
          to="/listings"
        >
          Back to listings
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">Loading…</div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <div className="text-red-300">
          Failed to load inbox: {(error as any)?.message ?? "Unknown error"}
        </div>
      </div>
    );
  }

  // Group into threads by (listing_id + buyer_id)
  const threadsMap = new Map<string, Thread>();
  for (const msg of data ?? []) {
    const key = `${msg.listing_id}::${msg.buyer_id}`;
    if (!threadsMap.has(key)) {
      threadsMap.set(key, {
        listing_id: msg.listing_id,
        buyer_id: msg.buyer_id,
        seller_id: msg.seller_id,
        last_message: msg.message,
        last_at: msg.created_at,
        listing: (msg.listings?.[0] ?? null),
      });
    }
  }
  const threads = Array.from(threadsMap.values()).sort(
    (a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime(),
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Messages</h1>
          <Link className="text-slate-300 hover:text-white" to="/listings">
            Browse listings →
          </Link>
        </div>

        {threads.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-slate-300">
            No messages yet.
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {threads.map((t) => {
              const title = t.listing
                ? `${t.listing.make} ${t.listing.model}${
                    t.listing.year ? ` (${t.listing.year})` : ""
                  }`
                : "Listing";

              const subtitle = t.listing?.price
                ? `$${Number(t.listing.price).toLocaleString()}`
                : "";

              return (
                <Link
                  key={`${t.listing_id}-${t.buyer_id}`}
                  to={`/messages/${t.listing_id}/${t.buyer_id}`}
                  className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 hover:bg-slate-900/60 transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold">{title}</div>
                      <div className="text-sm text-slate-400 mt-1">
                        {subtitle}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(t.last_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="mt-3 text-slate-300 line-clamp-2">
                    {t.last_message}
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