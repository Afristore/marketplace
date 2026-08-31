import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockStatsState: {
  stats: {
    tvl: number;
    volume24h: number;
    activeLoans: number;
    updatedAt: string | null;
  } | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

jest.mock("@/hooks/useLendingStats", () => ({
  useLendingStats: () => mockStatsState,
}));

import { LendingStatsBar } from "@/components/lending/LendingStatsBar";

const bar = () => screen.getByTestId("lending-stats-bar");

beforeEach(() => {
  jest.clearAllMocks();
  mockStatsState = {
    stats: {
      tvl: 1_500_000,
      activeLoans: 1234,
      volume24h: 3_400_000,
      updatedAt: "2026-08-31T12:00:00.000Z",
    },
    isLoading: false,
    error: null,
    refresh: jest.fn(),
  };
});

describe("LendingStatsBar", () => {
  describe("ready state", () => {
    it("renders the three labelled metrics", () => {
      render(<LendingStatsBar />);
      expect(bar()).toHaveAttribute("data-state", "ready");
      expect(screen.getByText("Total Value Locked")).toBeInTheDocument();
      expect(screen.getByText("Active Loans")).toBeInTheDocument();
      expect(screen.getByText("24h Volume")).toBeInTheDocument();
    });

    it("formats TVL as a compact XLM amount", () => {
      render(<LendingStatsBar />);
      expect(screen.getByTestId("stat-tvl")).toHaveTextContent("1.5M XLM");
    });

    it("formats Volume as a compact XLM amount", () => {
      render(<LendingStatsBar />);
      expect(screen.getByTestId("stat-volume")).toHaveTextContent("3.4M XLM");
    });

    it("formats Active Loans as a grouped plain count", () => {
      render(<LendingStatsBar />);
      expect(screen.getByTestId("stat-active-loans")).toHaveTextContent(
        "1,234",
      );
    });

    it("formats small XLM amounts without a compact suffix", () => {
      mockStatsState.stats = {
        tvl: 950,
        activeLoans: 0,
        volume24h: 0,
        updatedAt: null,
      };
      render(<LendingStatsBar />);
      expect(screen.getByTestId("stat-tvl")).toHaveTextContent("950 XLM");
      expect(screen.getByTestId("stat-volume")).toHaveTextContent("0 XLM");
    });
  });

  describe("loading state", () => {
    beforeEach(() => {
      mockStatsState = {
        stats: null,
        isLoading: true,
        error: null,
        refresh: jest.fn(),
      };
    });

    it("marks the bar as loading and shows a skeleton per metric", () => {
      render(<LendingStatsBar />);
      expect(bar()).toHaveAttribute("data-state", "loading");
      expect(screen.getByTestId("stat-tvl-skeleton")).toBeInTheDocument();
      expect(
        screen.getByTestId("stat-active-loans-skeleton"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("stat-volume-skeleton")).toBeInTheDocument();
    });

    it("does not render numeric values while loading", () => {
      render(<LendingStatsBar />);
      expect(screen.queryByTestId("stat-tvl")).not.toBeInTheDocument();
      expect(screen.queryByText("Stats unavailable")).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    beforeEach(() => {
      mockStatsState = {
        stats: null,
        isLoading: false,
        error: "HTTP 500",
        refresh: jest.fn(),
      };
    });

    it("renders an em dash placeholder for every metric", () => {
      render(<LendingStatsBar />);
      expect(bar()).toHaveAttribute("data-state", "error");
      expect(screen.getByTestId("stat-tvl")).toHaveTextContent("—");
      expect(screen.getByTestId("stat-active-loans")).toHaveTextContent("—");
      expect(screen.getByTestId("stat-volume")).toHaveTextContent("—");
    });

    it("shows a quiet status line", () => {
      render(<LendingStatsBar />);
      const status = screen.getByText("Stats unavailable");
      expect(status).toBeInTheDocument();
      expect(status).toHaveAttribute("role", "status");
    });
  });

  describe("empty state (no data, no error)", () => {
    it("renders placeholders without a status line", () => {
      mockStatsState = {
        stats: null,
        isLoading: false,
        error: null,
        refresh: jest.fn(),
      };
      render(<LendingStatsBar />);
      expect(bar()).toHaveAttribute("data-state", "empty");
      expect(screen.getByTestId("stat-tvl")).toHaveTextContent("—");
      expect(screen.queryByText("Stats unavailable")).not.toBeInTheDocument();
    });
  });

  it("passes through a caller className", () => {
    render(<LendingStatsBar className="mb-8" />);
    expect(bar()).toHaveClass("mb-8");
  });
});
