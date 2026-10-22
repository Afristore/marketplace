/**
 * Component tests for SearchFilter.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// lucide-react icons can cause issues in jsdom — mock them
jest.mock("lucide-react", () => ({
  Search: () => <span data-testid="icon-search" />,
  SlidersHorizontal: () => <span />,
  ArrowUpDown: () => <span />,
  X: () => <span data-testid="icon-x" />,
  Filter: () => <span />,
  AlertCircle: () => <span data-testid="icon-alert" />,
}));

import { SearchFilter } from "@/components/SearchFilter";
import type { Filters } from "@/components/SearchFilter";

const DEFAULT_FILTERS: Filters = {
  search: "",
  status: "All",
  category: "All",
  minPrice: "",
  maxPrice: "",
  sort: "newest",
};

describe("SearchFilter", () => {
  it("renders the search input", () => {
    const onChange = jest.fn();
    render(
      <SearchFilter
        filters={DEFAULT_FILTERS}
        onFilterChange={onChange}
        showFilters={false}
        setShowFilters={jest.fn()}
        totalResults={5}
      />,
    );
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("calls onFilterChange with updated search text", async () => {
    try {
      const onChange = jest.fn();
      const user = userEvent.setup();
      render(
        <SearchFilter
          filters={DEFAULT_FILTERS}
          onFilterChange={onChange}
          showFilters={false}
          setShowFilters={jest.fn()}
          totalResults={5}
        />,
      );
      await user.type(screen.getByPlaceholderText(/search/i), "landscape");
      expect(onChange).toHaveBeenCalledWith({ search: "l" });
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("calls setShowFilters when filter toggle button is clicked", async () => {
    try {
      const setShowFilters = jest.fn();
      const user = userEvent.setup();
      render(
        <SearchFilter
          filters={DEFAULT_FILTERS}
          onFilterChange={jest.fn()}
          showFilters={false}
          setShowFilters={setShowFilters}
          totalResults={0}
        />,
      );
      // Click the "Filters" toggle button
      const filterBtn = screen.getByRole("button", { name: /filter/i });
      await user.click(filterBtn);
      expect(setShowFilters).toHaveBeenCalledWith(true);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("shows status filter buttons when showFilters is true", () => {
    render(
      <SearchFilter
        filters={DEFAULT_FILTERS}
        onFilterChange={jest.fn()}
        showFilters={true}
        setShowFilters={jest.fn()}
        totalResults={0}
      />,
    );
    expect(screen.getByRole("button", { name: /active/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sold/i })).toBeInTheDocument();
  });

  it("calls onFilterChange with status when status button is clicked", async () => {
    try {
      const onChange = jest.fn();
      const user = userEvent.setup();
      render(
        <SearchFilter
          filters={DEFAULT_FILTERS}
          onFilterChange={onChange}
          showFilters={true}
          setShowFilters={jest.fn()}
          totalResults={0}
        />,
      );
      await user.click(screen.getByRole("button", { name: /^active$/i }));
      expect(onChange).toHaveBeenCalledWith({ status: "Active" });
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("shows the total results count", () => {
    render(
      <SearchFilter
        filters={DEFAULT_FILTERS}
        onFilterChange={jest.fn()}
        showFilters={false}
        setShowFilters={jest.fn()}
        totalResults={42}
      />,
    );
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("shows Reset All Filters button when filters are active", async () => {
    try {
      const onChange = jest.fn();
      const user = userEvent.setup();
      render(
        <SearchFilter
          filters={{ ...DEFAULT_FILTERS, search: "test" }}
          onFilterChange={onChange}
          showFilters={false}
          setShowFilters={jest.fn()}
          totalResults={0}
        />,
      );
      const clearBtn = screen.getByRole("button", { name: /reset all filters/i });
      expect(clearBtn).toBeInTheDocument();
      await user.click(clearBtn);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: "" }),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("does not show Reset All Filters button when no filters are active", () => {
    render(
      <SearchFilter
        filters={DEFAULT_FILTERS}
        onFilterChange={jest.fn()}
        showFilters={false}
        setShowFilters={jest.fn()}
        totalResults={0}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /reset all filters/i }),
    ).not.toBeInTheDocument();
  });
});

describe("SearchFilter — error handling", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("catches rejected async onFilterChange and displays error alert", async () => {
    try {
      const onChange = jest
        .fn()
        .mockRejectedValue(new Error("Network filter error"));
      const user = userEvent.setup();
      render(
        <SearchFilter
          filters={DEFAULT_FILTERS}
          onFilterChange={onChange}
          showFilters={true}
          setShowFilters={jest.fn()}
          totalResults={0}
        />,
      );

      await user.click(screen.getByRole("button", { name: /^active$/i }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Network filter error");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Filter change failed:",
        expect.any(Error),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("catches synchronous exception when onFilterChange throws", async () => {
    try {
      const onChange = jest.fn(() => {
        throw new Error("Synchronous filter failure");
      });
      const user = userEvent.setup();
      render(
        <SearchFilter
          filters={DEFAULT_FILTERS}
          onFilterChange={onChange}
          showFilters={true}
          setShowFilters={jest.fn()}
          totalResults={0}
        />,
      );

      await user.click(screen.getByRole("button", { name: /^active$/i }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Synchronous filter failure");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("uses fallback message for non-Error rejection values", async () => {
    try {
      const onChange = jest.fn().mockRejectedValue("unknown network failure");
      const user = userEvent.setup();
      render(
        <SearchFilter
          filters={DEFAULT_FILTERS}
          onFilterChange={onChange}
          showFilters={false}
          setShowFilters={jest.fn()}
          totalResults={5}
        />,
      );

      await user.type(screen.getByPlaceholderText(/search/i), "a");

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Failed to apply filter. Please try again.");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("allows dismissing the error alert via the dismiss button", async () => {
    try {
      const onChange = jest
        .fn()
        .mockRejectedValueOnce(new Error("Dismissable error"));
      const user = userEvent.setup();
      render(
        <SearchFilter
          filters={DEFAULT_FILTERS}
          onFilterChange={onChange}
          showFilters={true}
          setShowFilters={jest.fn()}
          totalResults={0}
        />,
      );

      await user.click(screen.getByRole("button", { name: /^active$/i }));
      expect(await screen.findByRole("alert")).toBeInTheDocument();

      const dismissBtn = screen.getByRole("button", {
        name: /dismiss error/i,
      });
      await user.click(dismissBtn);

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("clears previous error alert when a subsequent filter change succeeds", async () => {
    try {
      const onChange = jest
        .fn()
        .mockRejectedValueOnce(new Error("Temporary error"))
        .mockResolvedValueOnce(undefined);
      const user = userEvent.setup();
      render(
        <SearchFilter
          filters={DEFAULT_FILTERS}
          onFilterChange={onChange}
          showFilters={true}
          setShowFilters={jest.fn()}
          totalResults={0}
        />,
      );

      await user.click(screen.getByRole("button", { name: /^active$/i }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Temporary error");

      await user.click(screen.getByRole("button", { name: /^sold$/i }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("catches errors when setShowFilters throws", async () => {
    try {
      const setShowFilters = jest.fn(() => {
        throw new Error("Toggle filters failure");
      });
      const user = userEvent.setup();
      render(
        <SearchFilter
          filters={DEFAULT_FILTERS}
          onFilterChange={jest.fn()}
          showFilters={false}
          setShowFilters={setShowFilters}
          totalResults={0}
        />,
      );

      const filterBtn = screen.getByRole("button", { name: /filter/i });
      await user.click(filterBtn);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Toggle filters failure");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("catches rejection when clearFilters fails", async () => {
    try {
      const onChange = jest.fn().mockRejectedValue(new Error("Clear failed"));
      const user = userEvent.setup();
      render(
        <SearchFilter
          filters={{ ...DEFAULT_FILTERS, search: "active_query" }}
          onFilterChange={onChange}
          showFilters={false}
          setShowFilters={jest.fn()}
          totalResults={0}
        />,
      );

      const clearBtn = screen.getByRole("button", { name: /reset all filters/i });
      await user.click(clearBtn);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Clear failed");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});
