export function FilterBar({ filters, setFilters }: any) {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800 flex flex-wrap gap-4 items-center">
        {/* Search Input */}
        <input
          type="text"
          placeholder="Search make or model..."
          className="bg-slate-800 border-none rounded-lg px-4 py-2 text-white flex-1 min-w-[200px] focus:ring-2 focus:ring-blue-500"
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />

        {/* Make Dropdown */}
        <select
          className="bg-slate-800 border-none rounded-lg px-4 py-2 text-white min-w-[150px]"
          onChange={(e) => setFilters({ ...filters, make: e.target.value })}
        >
          <option value="">All Makes</option>
          <option value="Porsche">Porsche</option>
          <option value="Rivian">Rivian</option>
          <option value="Toyota">Toyota</option>
        </select>

        {/* Price Slider Label */}
        <div className="flex flex-col flex-1 min-w-[200px]">
          <span className="text-xs text-slate-400 mb-1">
            Max Price: ${filters.maxPrice.toLocaleString()}
          </span>
          <input
            type="range"
            min="10000"
            max="200000"
            step="5000"
            value={filters.maxPrice}
            className="accent-blue-500"
            onChange={(e) =>
              setFilters({ ...filters, maxPrice: Number(e.target.value) })
            }
          />
        </div>
      </div>
    </div>
  );
}
