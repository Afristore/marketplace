"use client";

import React, { useState } from "react";

interface InterestScheduleChartProps {
  /** Array of basis points for each month */
  schedule: number[];
  /** Chart height in pixels */
  height?: number;
  /** Chart width in pixels */
  width?: number;
}

/**
 * Renders a stepped line chart visualizing the interest schedule over time.
 * Uses pure SVG without external dependencies.
 */
export function InterestScheduleChart({
  schedule,
  height = 200,
  width = 400,
}: InterestScheduleChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!schedule || schedule.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] p-4">
        <p className="text-sm text-gray-400">No interest schedule data</p>
      </div>
    );
  }

  const maxBps = Math.max(...schedule);
  const minBps = Math.min(...schedule);
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Scale functions
  const xScale = (index: number) => (index / (schedule.length - 1 || 1)) * chartWidth;
  const yScale = (bps: number) => {
    const range = maxBps - minBps || 1;
    return chartHeight - ((bps - minBps) / range) * chartHeight;
  };

  // Build stepped path
  const pathPoints: string[] = [];
  schedule.forEach((bps, i) => {
    const x = xScale(i) + padding.left;
    const y = yScale(bps) + padding.top;
    if (i === 0) {
      pathPoints.push(`M ${x} ${y}`);
    } else {
      // Step: horizontal then vertical
      const prevX = xScale(i - 1) + padding.left;
      pathPoints.push(`H ${x}`);
      pathPoints.push(`V ${y}`);
    }
  });
  const pathD = pathPoints.join(" ");

  // Fill path (close to bottom)
  const fillD = `${pathD} L ${xScale(schedule.length - 1) + padding.left} ${chartHeight + padding.top} L ${padding.left} ${chartHeight + padding.top} Z`;

  // Y-axis ticks
  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks }, (_, i) => {
    const range = maxBps - minBps || 1;
    return minBps + (range * i) / (yTicks - 1);
  });

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-400">Interest Schedule</h4>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>Min: {(minBps / 100).toFixed(2)}%</span>
          <span>Max: {(maxBps / 100).toFixed(2)}%</span>
        </div>
      </div>
      <svg width={width} height={height} className="w-full">
        {/* Grid lines */}
        {yTickValues.map((tick, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={yScale(tick) + padding.top}
              x2={width - padding.right}
              y2={yScale(tick) + padding.top}
              stroke="rgba(255,255,255,0.05)"
              strokeDasharray="3 3"
            />
            <text
              x={padding.left - 5}
              y={yScale(tick) + padding.top}
              textAnchor="end"
              fill="rgba(255,255,255,0.5)"
              fontSize={10}
            >
              {(tick / 100).toFixed(1)}%
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {schedule.map((_, i) => (
          <text
            key={i}
            x={xScale(i) + padding.left}
            y={height - 5}
            textAnchor="middle"
            fill="rgba(255,255,255,0.5)"
            fontSize={10}
          >
            {i + 1}
          </text>
        ))}

        {/* X-axis label */}
        <text
          x={width / 2}
          y={height - 0}
          textAnchor="middle"
          fill="rgba(255,255,255,0.4)"
          fontSize={11}
        >
          Month
        </text>

        {/* Fill area */}
        <path d={fillD} fill="#4AE292" fillOpacity={0.12} />

        {/* Line */}
        <path d={pathD} fill="none" stroke="#4AE292" strokeWidth={2} strokeLinejoin="round" />

        {/* Data points */}
        {schedule.map((bps, i) => {
          const x = xScale(i) + padding.left;
          const y = yScale(bps) + padding.top;
          const isHovered = hoveredIndex === i;
          return (
            <g key={i}>
              <circle
                cx={x}
                cy={y}
                r={isHovered ? 6 : 4}
                fill={isHovered ? "#0A1324" : "#4AE292"}
                stroke="#4AE292"
                strokeWidth={isHovered ? 2 : 0}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{ cursor: "pointer" }}
              />
              {/* Tooltip */}
              {isHovered && (
                <g>
                  <rect
                    x={x - 40}
                    y={y - 45}
                    width={80}
                    height={35}
                    rx={4}
                    fill="#0A1324"
                    stroke="rgba(255,255,255,0.1)"
                  />
                  <text x={x} y={y - 30} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={10}>
                    Month {i + 1}
                  </text>
                  <text x={x} y={y - 17} textAnchor="middle" fill="white" fontSize={12} fontWeight={600}>
                    {(bps / 100).toFixed(2)}%
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
