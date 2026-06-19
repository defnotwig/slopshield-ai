"use client";

import React from "react";
import {
  RadialBarChart,
  RadialBar,
  ResponsiveContainer,
  PolarAngleAxis,
} from "recharts";

interface ScoreGaugeProps {
  score: number;
  size?: number;
}

export function ScoreGauge({ score, size = 180 }: ScoreGaugeProps) {
  // Normalize score
  const displayScore = Math.max(0, Math.min(100, score));

  // Determine color based on score status
  const getColor = (s: number) => {
    if (s >= 90) return "var(--color-status-passed, #10b981)";
    if (s >= 80) return "var(--color-status-warning, #f59e0b)";
    if (s >= 70) return "var(--color-status-warning, #f59e0b)";
    if (s >= 60) return "var(--color-status-risky, #f97316)";
    return "var(--color-status-blocked, #ef4444)";
  };

  const getStatusText = (s: number) => {
    if (s >= 90) return "PASSED";
    if (s >= 80) return "WARNING";
    if (s >= 70) return "CLEANUP";
    if (s >= 60) return "RISKY";
    return "BLOCKED";
  };

  const color = getColor(displayScore);
  const status = getStatusText(displayScore);

  const data = [
    {
      name: "Score",
      value: displayScore,
      fill: color,
    },
  ];

  return (
    <div
      className="flex flex-col items-center justify-center relative"
      style={{ width: size, height: size }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="75%"
          outerRadius="100%"
          barSize={8}
          data={data}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis
            type="number"
            domain={[0, 100]}
            angleAxisId={0}
            tick={false}
          />
          <RadialBar
            background={{ fill: "var(--color-border)", opacity: 0.5 }}
            dataKey="value"
            cornerRadius={0}
          />
        </RadialBarChart>
      </ResponsiveContainer>

      {/* Internal Center Label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
          Score
        </span>
        <span
          className="font-display text-5xl font-extrabold transition-all duration-500 animate-count-up tracking-tight"
          style={{ color }}
        >
          {displayScore}
        </span>
        <span
          className="text-[9px] font-mono font-bold tracking-widest px-2 py-0.5 mt-1 border rounded-none transition-all duration-300"
          style={{
            color,
            borderColor: `${color}44`,
            backgroundColor: `${color}11`,
          }}
        >
          {status}
        </span>
      </div>
    </div>
  );
}
