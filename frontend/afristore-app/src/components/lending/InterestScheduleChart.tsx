// ─────────────────────────────────────────────────────────────
// components/lending/InterestScheduleChart.tsx
// ─────────────────────────────────────────────────────────────
// A small line chart that visualizes the stepped interest
// schedule of a lending listing: basis points over time in
// months. The last schedule entry repeats indefinitely on-chain;
// the chart renders one point per schedule step.
//
// Tooltips show the exact percentage, e.g. "500 bps = 5.00%".
//──────────────────────────────────────────────────────────────

"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { toBigInt } from "@/lib/lendingMath";
import { formatBpsPercent } from "./format";

/** A single point on the chart: the interest rate for a given month. */
export interface SchedulePoint {
  /** 1-indexed month the step applies to ("after the N-th month"). */
  month: number;
  /** Stepped interest rate in basis points (u32 on-chain). */
  bps: number;
  /** Percentage value (bps / 100) used as the line's y-value. */
  percent: number;
}

/**
 * Maps a u32 basis-point schedule to chart points. Each entry in the
 * array becomes one step; month numbers are 1-indexed and start at 1.
 * Returns an empty array for an empty schedule.
 */
export function buildSchedulePoints(
  schedule: readonly (number | bigint)[],
): SchedulePoint[] {
  return schedule.map((bpsRaw, index) => {
    const bps = Number(toBigInt(bpsRaw, `schedule[${index}]`));
    return { month: index + 1, bps, percent: bps / 100 };
  });
}

interface ScheduleTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ payload: SchedulePoint }>;
}

/**
 * Custom tooltip that reports the exact bps-to-percentage conversion.
 * Exported so it can be unit-tested directly; Recharts renders it with
 * the `active`/`payload`/`label` props as the user hovers the chart.
 */
export function InterestScheduleTooltip({
  active,
  label,
  payload,
}: ScheduleTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div
      data-testid="interest-schedule-tooltip"
      className="rounded-xl border border-white/10 bg-midnight-950/95 px-3 py-2 text-xs shadow-xl backdrop-blur-sm"
    >
      <p className="text-white/60">After month {label}</p>
      <p className="mt-0.5 font-mono font-bold text-brand-300">
        {point.bps} bps = {formatBpsPercent(point.bps)}
      </p>
    </div>
  );
}

interface ChartContentProps {
  data: SchedulePoint[];
  height: number;
  width?: number;
}

function ChartContent({ data, height, width }: ChartContentProps) {
  const children = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
      <XAxis
        dataKey="month"
        stroke="#ffffff55"
        tick={{ fill: "#ffffff77", fontSize: 11 }}
        tickLine={false}
        axisLine={{ stroke: "#ffffff22" }}
      />
      <YAxis
        stroke="#ffffff55"
        tick={{ fill: "#ffffff77", fontSize: 11 }}
        tickLine={false}
        axisLine={false}
        width={44}
        tickFormatter={(value: number) => `${value}%`}
        domain={["dataMin - 1", "dataMax + 1"]}
      />
      <Tooltip
        content={<InterestScheduleTooltip />}
        cursor={{ stroke: "#ffffff33", strokeDasharray: "4 4" }}
      />
      <Line
        type="stepAfter"
        dataKey="percent"
        name="Interest rate"
        stroke="#26a76e"
        strokeWidth={2}
        dot={{ r: 4, fill: "#26a76e", strokeWidth: 0 }}
        activeDot={{ r: 6, fill: "#48c189" }}
        isAnimationActive={false}
      />
    </>
  );

  if (typeof width === "number") {
    return (
      <LineChart width={width} height={height} data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        {children}
      </LineChart>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        {children}
      </LineChart>
    </ResponsiveContainer>
  );
}

interface InterestScheduleChartProps {
  /** Per-month interest schedule in basis points (u32 on-chain). */
  schedule: readonly (number | bigint)[];
  /** Chart height in px (ResponsiveContainer height). Defaults to 160. */
  height?: number;
  /**
   * Optional fixed width in px. When provided the chart renders at an
   * exact size (deterministic layout for tests/embeds); otherwise it
   * fills the parent container width.
   */
  width?: number;
  className?: string;
}

export function InterestScheduleChart({
  schedule,
  height = 160,
  width,
  className,
}: InterestScheduleChartProps) {
  const data = buildSchedulePoints(schedule);

  if (data.length === 0) {
    return (
      <div
        data-testid="interest-schedule-empty"
        className="flex items-center gap-2 rounded-2xl bg-white/[0.02] border border-white/5 px-4 py-3 text-xs text-white/50"
      >
        <BarChart3 size={14} className="text-white/30" />
        <span>No interest schedule available for this listing.</span>
      </div>
    );
  }

  return (
    <div
      data-testid="interest-schedule-chart"
      className={className}
      role="img"
      aria-label={`Interest schedule: ${data
        .map((d) => `${d.bps} basis points after month ${d.month}`)
        .join(", ")}`}
    >
      <ChartContent data={data} height={height} width={width} />
    </div>
  );
}