/**
 * Component tests for InterestScheduleChart.
 * Recharts renders SVG; a ResizeObserver stub is provided for the
 * responsive container, and a fixed `width` is used for deterministic
 * assertions on the rendered chart.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  InterestScheduleChart,
  InterestScheduleTooltip,
  buildSchedulePoints,
} from "@/components/lending/InterestScheduleChart";
import { formatBpsPercent } from "@/components/lending/format";

// jsdom does not ship ResizeObserver; recharts' ResponsiveContainer
// uses it to measure its wrapper, so we stub it for tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

describe("InterestScheduleChart helpers", () => {
  it("maps a u32 basis-point schedule into 1-indexed month steps", () => {
    expect(buildSchedulePoints([500, 1000, 1500])).toEqual([
      { month: 1, bps: 500, percent: 5 },
      { month: 2, bps: 1000, percent: 10 },
      { month: 3, bps: 1500, percent: 15 },
    ]);
  });

  it("handles bigint bps values from the contract client", () => {
    expect(buildSchedulePoints([500n, 1000n])).toEqual([
      { month: 1, bps: 500, percent: 5 },
      { month: 2, bps: 1000, percent: 10 },
    ]);
  });

  it("formats bps as an exact percentage (500 bps = 5.00%)", () => {
    expect(formatBpsPercent(500)).toBe("5.00%");
    expect(formatBpsPercent(1250)).toBe("12.50%");
    expect(formatBpsPercent(100)).toBe("1.00%");
  });
});

describe("InterestScheduleTooltip", () => {
  it("renders the exact bps-to-percentage conversion", () => {
    render(
      <InterestScheduleTooltip
        active
        label="2"
        payload={[{ payload: { month: 2, bps: 1000, percent: 10 } }]}
      />,
    );

    expect(screen.getByTestId("interest-schedule-tooltip")).toBeInTheDocument();
    expect(screen.getByText("After month 2")).toBeInTheDocument();
    expect(screen.getByText("1000 bps = 10.00%")).toBeInTheDocument();
  });

  it("renders nothing when inactive or without payload", () => {
    const { container } = render(
      <InterestScheduleTooltip active={false} payload={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("InterestScheduleChart", () => {
  it("renders a line chart for a non-empty schedule", () => {
    const { container } = render(
      <InterestScheduleChart
        schedule={[500, 1000, 1500]}
        width={520}
        height={160}
      />,
    );

    expect(screen.getByTestId("interest-schedule-chart")).toBeInTheDocument();
    // Recharts renders an SVG surface with x/y axes.
    expect(container.querySelector("svg")).toBeInTheDocument();
    // Y-axis percentage ticks present (e.g. "5%", "10%", "15%").
    expect(screen.getAllByText(/%$/).length).toBeGreaterThan(0);
  });

  it("handles a single-entry schedule", () => {
    const { container } = render(
      <InterestScheduleChart schedule={[750]} width={520} height={160} />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders an empty state for an empty schedule", () => {
    render(<InterestScheduleChart schedule={[]} width={520} />);

    expect(screen.getByTestId("interest-schedule-empty")).toBeInTheDocument();
    expect(
      screen.getByText("No interest schedule available for this listing."),
    ).toBeInTheDocument();
  });
});