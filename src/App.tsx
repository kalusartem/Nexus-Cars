import { Routes, Route, Link } from "react-router-dom";
import { useState } from "react";
import { FilterBar } from "./features/listings/components/FilterBar";
import { FeaturedListings } from "./features/listings/components/FeaturedListings";
import { ListingsPage } from "./features/listings/pages/ListingsPage";
import { ListingDetailsPage } from "./features/listings/pages/ListingDetailsPage";
import { CreateListingPage } from "./features/listings/pages/CreateListingPage";
import { EditListingPage } from "./features/listings/pages/EditListingPage";

export default function App() {
  const [filters, setFilters] = useState({
    search: "",
    make: "",
    maxPrice: 200000,
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <nav className="border-b border-slate-800 p-4 flex items-center justify-between">
        <Link
          to="/"
          className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400"
        >
          🏎️💨 Car Market
        </Link>

        <Link
          to="/listings"
          className="text-sm text-slate-300 hover:text-white"
        >
          Browse
        </Link>
        <Link to="/sell" className="text-sm text-slate-300 hover:text-white">
          Sell
        </Link>
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
      </Routes>
    </div>
  );
}
