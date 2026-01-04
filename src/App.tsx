import { Routes, Route, Link } from "react-router-dom";
import { useState } from "react";
import { FilterBar } from "./features/listings/components/FilterBar";
import { FeaturedListings } from "./features/listings/components/FeaturedListings";
import { ListingsPage } from "./features/listings/pages/ListingsPage";
import { ListingDetailsPage } from "./features/listings/pages/ListingDetailsPage";
import { CreateListingPage } from "./features/listings/pages/CreateListingPage";
import { EditListingPage } from "./features/listings/pages/EditListingPage";
import { FavoritesPage } from "./features/favorites/pages/FavoritesPage";
import { AccountMenu } from "./components/AccountMenu";
import { AccountPage } from "./features/account/pages/AccountPage";
import { MyListingsPage } from "./features/account/pages/MyListingsPage";

export default function App() {
  const [filters, setFilters] = useState({
    search: "",
    make: "",
    // Number.MAX_SAFE_INTEGER means "no max" (keeps behavior consistent with Browse page)
    maxPrice: Number.MAX_SAFE_INTEGER,
    zip: "",
    radiusMiles: 0,
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      {/* z-40 keeps header above page content; account popover will be higher (z-50+) */}
      <nav className="border-b border-slate-800 p-4 flex items-center justify-between relative z-40">
        <Link
          to="/"
          className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400"
        >
          🏎️💨 Car Market
        </Link>
        <div className="flex items-center gap-4">
          <Link
            to="/listings"
            className="text-sm text-slate-300 hover:text-white"
          >
            Browse
          </Link>
          <AccountMenu />
        </div>
      </nav>

      <Routes>
        <Route
          path="/"
          element={
            <main>
              <FilterBar filters={filters} setFilters={setFilters} />
              <FeaturedListings filters={filters} />
            </main>
          }
        />
        <Route path="/listings" element={<ListingsPage />} />
        <Route path="/listings/:id" element={<ListingDetailsPage />} />
        <Route path="/sell" element={<CreateListingPage />} />
        <Route path="/listings/:id/edit" element={<EditListingPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/account/listings" element={<MyListingsPage />} />
      </Routes>
    </div>
  );
}
