"use client";

import {
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  X,
  Filter,
} from "lucide-react";
import { ART_CATEGORIES } from "./ListingForm";

export type StatusFilter = "All" | "Active" | "Sold" | "Cancelled";
export type SortOption = "newest" | "oldest" | "price_asc" | "price_desc";

export interface Filters {
  search: string;
  status: StatusFilter;
  category: string;
  minPrice: string;
  maxPrice: string;
  sort: SortOption;
}

const STATUS_FILTERS: StatusFilter[] = ["All", "Active", "Sold", "Cancelled"];
const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
];

interface SearchFilterProps {
  filters: Filters;
  onFilterChange: (filters: Partial<Filters>) => void;
  showFilters: boolean;
  setShowFilters: (show: boolean) => void;
  totalResults: number;
}

export function SearchFilter({
  filters,
  onFilterChange,
  showFilters,
  setShowFilters,
  totalResults,
}: SearchFilterProps) {
  const clearFilters = () => {
    onFilterChange({
      search: "",
      status: "All",
      category: "All",
      minPrice: "",
      maxPrice: "",
    });
  };

  const hasActiveFilters =
    filters.search !== "" ||
    filters.status !== "All" ||
    filters.category !== "All" ||
    filters.minPrice !== "" ||
    filters.maxPrice !== "";

  return (
    <div className="sticky top-16 z-30 border-b border-gray-200 bg-white/95 backdrop-blur-sm shadow-sm transition-all duration-300">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-xl">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder="Search by title, artist, or description..."
              value={filters.search}
              onChange={(e) => onFilterChange({ search: e.target.value })}
              className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3 pl-12 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-500/10 transition-all shadow-sm"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                showFilters || hasActiveFilters
                  ? "border-brand-500 bg-brand-50 text-brand-600 shadow-sm"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <SlidersHorizontal size={16} />
              <span className="hidden sm:inline">Advanced Filters</span>
              <span className="sm:hidden">Filters</span>
              {hasActiveFilters && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-[10px] text-white">
                  !
                </span>
              )}
            </button>

            <div className="relative">
              <ArrowUpDown
                size={16}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
              <select
                value={filters.sort}
                onChange={(e) =>
                  onFilterChange({ sort: e.target.value as SortOption })
                }
                className="appearance-none rounded-xl border border-gray-200 bg-gray-50 py-3 pl-12 pr-10 text-sm font-semibold text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10 cursor-pointer shadow-sm transition-all"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out ${
            showFilters ? "mt-6 max-h-[500px] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="grid gap-6 rounded-2xl bg-gray-50 p-6 sm:grid-cols-2 lg:grid-cols-4 border border-gray-100 italic font-inter">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Status
              </label>
              <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map((status) => (
                  <button
                    key={status}
                    onClick={() => onFilterChange({ status })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                      filters.status === status
                        ? "bg-brand-500 text-white shadow-md shadow-brand-500/20"
                        : "bg-white text-gray-600 border border-gray-200 hover:border-brand-300"
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Category
              </label>
              <select
                value={filters.category}
                onChange={(e) => onFilterChange({ category: e.target.value })}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              >
                <option value="All">All Categories</option>
                {ART_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Price Range (XLM)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  placeholder="Min"
                  value={filters.minPrice}
                  onChange={(e) => onFilterChange({ minPrice: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
                <span className="text-gray-400">—</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={filters.maxPrice}
                  onChange={(e) => onFilterChange({ maxPrice: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between px-2">
            <p className="text-sm text-gray-500">
              Found{" "}
              <span className="font-bold text-gray-900">{totalResults}</span>{" "}
              results matching your criteria
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 text-sm font-bold text-brand-600 hover:text-brand-700 transition-colors"
              >
                <X size={14} />
                Reset All Filters
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
