import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { HealthFactorBadge } from "@/components/lending/HealthFactorBadge";
import { MAX_HEALTH_FACTOR_BPS } from "@/lib/lendingMath";

const badge = () => screen.getByTestId("health-factor-badge");

describe("HealthFactorBadge", () => {
  describe("asymmetric risk boundaries (basis points)", () => {
    it("11000 bps (=110%) is red / liquidatable", () => {
      render(<HealthFactorBadge healthFactorBps={11_000n} />);
      expect(badge()).toHaveAttribute("data-risk", "liquidatable");
      expect(badge().className).toContain("text-red-300");
    });

    it("11001 bps is yellow / caution (just above the liquidation line)", () => {
      render(<HealthFactorBadge healthFactorBps={11_001n} />);
      expect(badge()).toHaveAttribute("data-risk", "caution");
      expect(badge().className).toContain("text-amber-300");
    });

    it("15000 bps (=150%) is yellow / caution (not yet healthy)", () => {
      render(<HealthFactorBadge healthFactorBps={15_000n} />);
      expect(badge()).toHaveAttribute("data-risk", "caution");
      expect(badge().className).toContain("text-amber-300");
    });

    it("15001 bps is green / healthy (strictly above 150%)", () => {
      render(<HealthFactorBadge healthFactorBps={15_001n} />);
      expect(badge()).toHaveAttribute("data-risk", "healthy");
      expect(badge().className).toContain("text-mint-300");
    });
  });

  describe("clearly-in-band values", () => {
    it("5000 bps is red / liquidatable", () => {
      render(<HealthFactorBadge healthFactorBps={5_000n} />);
      expect(badge()).toHaveAttribute("data-risk", "liquidatable");
    });

    it("13000 bps is yellow / caution", () => {
      render(<HealthFactorBadge healthFactorBps={13_000n} />);
      expect(badge()).toHaveAttribute("data-risk", "caution");
    });

    it("30000 bps is green / healthy", () => {
      render(<HealthFactorBadge healthFactorBps={30_000n} />);
      expect(badge()).toHaveAttribute("data-risk", "healthy");
    });
  });

  it("renders the health factor as a percentage", () => {
    render(<HealthFactorBadge healthFactorBps={14_285n} />);
    expect(screen.getByText("142.85%")).toBeInTheDocument();
  });

  describe("red state carries a pulse affordance", () => {
    it("applies animate-pulse only when liquidatable", () => {
      const { rerender } = render(
        <HealthFactorBadge healthFactorBps={11_000n} />,
      );
      expect(badge().className).toContain("animate-pulse");

      rerender(<HealthFactorBadge healthFactorBps={20_000n} />);
      expect(badge().className).not.toContain("animate-pulse");
    });
  });

  describe("accessibility: risk is conveyable without colour", () => {
    it("exposes the risk level via aria-label / title for the red state", () => {
      render(<HealthFactorBadge healthFactorBps={10_500n} />);
      expect(badge()).toHaveAttribute(
        "aria-label",
        expect.stringContaining("at risk of liquidation"),
      );
      expect(badge()).toHaveAttribute("title", expect.stringContaining("105.00%"));
    });

    it("exposes the risk level for the yellow state", () => {
      render(<HealthFactorBadge healthFactorBps={12_000n} />);
      expect(badge()).toHaveAttribute(
        "aria-label",
        expect.stringContaining("moderate liquidation risk"),
      );
    });

    it("exposes the risk level for the green state", () => {
      render(<HealthFactorBadge healthFactorBps={25_000n} />);
      expect(badge()).toHaveAttribute(
        "aria-label",
        expect.stringContaining("healthy"),
      );
    });
  });

  describe("edge cases render safely", () => {
    it("renders a neutral badge for undefined", () => {
      render(<HealthFactorBadge healthFactorBps={undefined} />);
      expect(badge()).toHaveAttribute("data-risk", "unknown");
      expect(screen.getByText("—")).toBeInTheDocument();
      expect(badge()).toHaveAttribute("aria-label", "Health factor unknown");
    });

    it("renders a neutral badge for null", () => {
      render(<HealthFactorBadge healthFactorBps={null} />);
      expect(badge()).toHaveAttribute("data-risk", "unknown");
    });

    it("renders a neutral badge for NaN", () => {
      render(<HealthFactorBadge healthFactorBps={NaN} />);
      expect(badge()).toHaveAttribute("data-risk", "unknown");
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("treats 0 bps as liquidatable", () => {
      render(<HealthFactorBadge healthFactorBps={0n} />);
      expect(badge()).toHaveAttribute("data-risk", "liquidatable");
      expect(screen.getByText("0.00%")).toBeInTheDocument();
    });

    it("treats a negative value as liquidatable without crashing", () => {
      render(<HealthFactorBadge healthFactorBps={-5_000n} />);
      expect(badge()).toHaveAttribute("data-risk", "liquidatable");
      expect(screen.getByText("-50.00%")).toBeInTheDocument();
    });

    it("shows the no-debt sentinel as a neutral, non-pulsing badge", () => {
      render(<HealthFactorBadge healthFactorBps={MAX_HEALTH_FACTOR_BPS} />);
      expect(badge().className).not.toContain("animate-pulse");
      expect(screen.getByText("—")).toBeInTheDocument();
      expect(badge()).toHaveAttribute(
        "aria-label",
        "Health factor — no outstanding debt",
      );
    });

    it("accepts a plain integer as well as bigint", () => {
      render(<HealthFactorBadge healthFactorBps={9_000} />);
      expect(badge()).toHaveAttribute("data-risk", "liquidatable");
    });
  });
});
