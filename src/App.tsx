import { FeaturedListings } from "./features/listings/components/FeaturedListings";
import { useState } from "react"; // Add this line
import { FilterBar } from "./features/listings/components/FilterBar"; // Don't forget this one too!

function App() {
  const [filters, setFilters] = useState({
    search: "",
    make: "",
    maxPrice: 200000,
  });
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      {/* Navigation Placeholder */}
      <nav className="border-b border-slate-800 p-4">
        <h1 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
          🏎️💨 Car Market
        </h1>
      </nav>

      <main>
        <FilterBar filters={filters} setFilters={setFilters} />
        <FeaturedListings filters={filters} />
      </main>
    </div>
  );
}

export default App;
