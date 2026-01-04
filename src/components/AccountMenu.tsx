import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { fetchAuthUser } from "../lib/auth";

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ["auth-user"],
    queryFn: fetchAuthUser,
    staleTime: 1000 * 30,
  });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const signInGithub = async () => {
    // Redirect back to your site root after OAuth
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.origin },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    await qc.invalidateQueries({ queryKey: ["auth-user"] });
    await qc.invalidateQueries({ queryKey: ["auth-user-id"] });
    await qc.invalidateQueries({ queryKey: ["favorites"] });
    setOpen(false);
    navigate("/");
  };

  const label = user?.email ?? user?.user_metadata?.user_name ?? "Account";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="w-10 h-10 rounded-full border border-slate-800 bg-slate-900/40 hover:bg-slate-800 flex items-center justify-center"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        title={user ? label : "Sign in"}
      >
        {/* simple user icon */}
        <span className="text-lg">👤</span>
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-800 bg-slate-950 shadow-lg overflow-hidden z-[60]">
          {user ? (
            <>
              <div className="px-3 py-2 text-xs text-slate-400 border-b border-slate-800">
                Signed in as <span className="text-slate-200">{label}</span>
              </div>

              <Link
                to="/account"
                className="block px-3 py-2 text-sm hover:bg-slate-900"
                onClick={() => setOpen(false)}
              >
                My Account
              </Link>

              <Link
                to="/sell"
                className="block px-3 py-2 text-sm hover:bg-slate-900"
                onClick={() => setOpen(false)}
              >
                Sell
              </Link>
              <Link
                to="/favorites"
                className="block px-3 py-2 text-sm hover:bg-slate-900"
                onClick={() => setOpen(false)}
              >
                Favorites
              </Link>
              <Link
                to="/account/listings"
                className="block px-3 py-2 text-sm hover:bg-slate-900"
                onClick={() => setOpen(false)}
              >
                My Listings
              </Link>

              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-900 text-red-300"
                onClick={signOut}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <div className="px-3 py-2 text-xs text-slate-400 border-b border-slate-800">
                You are not signed in
              </div>

              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-900"
                onClick={signInGithub}
              >
                Sign in with GitHub
              </button>

              <div className="px-3 py-2 text-xs text-slate-500">
                No password needed.
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
