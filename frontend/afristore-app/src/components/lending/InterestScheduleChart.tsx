"use client";

import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface InterestScheduleChartProps {
  /** Array of basis points for each month */
  schedule: number[];
  /** Chart height in pixels */
  height?: number;
  /** Chart width (defaults to 100% responsive) */
  width?: number | string;
}

interface DataPoint {
  month: number;
  bps: number;
  percentage: number;
}

/**
 * Renders a stepped line chart visualizing the interest schedule over time.
 * Each data point represents a month with its corresponding basis points.
 */
export function InterestScheduleChart({
  schedule,
  height = 200,
  width = "100%",
}: InterestScheduleChartProps) {
  if (!schedule || schedule.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] p-4">
        <p className="text-sm text-gray-400">No interest schedule data</p>
      </div>
    );
  }

  const data: DataPoint[] = schedule.map((bps, index) => ({
    month: index + 1,
    bps,
    percentage: bps / 100,
  }));

  const maxBps = Math.max(...schedule);
  const minBps = Math.min(...schedule);

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ payload: DataPoint }>;
  }) => {
    if (active && payload && payload.length > 0) {
      const point = payload[0].payload;
      return (
        <div className="rounded-lg border border-white/10 bg-[#0A1324] px-3 py-2 shadow-lg">
          <p className="text-xs text-gray-400">Month {point.month}</p>
          <p className="text-sm font-semibold text-white">
            {point.percentage.toFixed(2)}%
          </p>
          <p className="text-xs text-gray-400">{point.bps} bps</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-400">Interest Schedule</h4>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>
            Min: {(minBps / 100).toFixed(2)}%
          </span>
          <span>
            Max: {(maxBps / 100).toFixed(2)}%
          </span>
        </div>
      </div>
      <ResponsiveContainer width={width} height={height}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="month"
            stroke="rgba(255,255,255,0.3)"
            tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }}
            label={{
              value: "Month",
              position: "insideBottomRight",
              offset: -5,
              fill: "rgba(255,255,255,0.4)",
              fontSize: 11,
            }}
          />
          <YAxis
            stroke="rgba(255,255,255,0.3)"
            tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }}
            label={{
              value: "Rate (%)",
              angle: -90,
              position: "insideLeft",
              fill: "rgba(255,255,255,0.4)",
              fontSize: 11,
            }}
            tickFormatter={(value: number) => `${(value / 100).toFixed(1)}%`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="stepAfter"
            dataKey="bps"
            stroke="#4AE292"
            strokeWidth={2}
            dot={{ fill: "#4AE292", strokeWidth: 0, r: 4 }}
            activeDot={{ r: 6, stroke: "#4AE292", strokeWidth: 2, fill: "#0A1324" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
