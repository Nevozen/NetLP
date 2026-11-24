"use client";

import { useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";
import { D } from "@/domain/values";
import { equivalent } from "@/lib/display";
import type { Observation } from "@/server/analytics";
import { Button } from "./ui";

export function PerformanceChart({
  points,
  label,
}: {
  points: Observation[];
  label: string;
}) {
  const [edge, setEdge] = useState(false);
  const numbers = points.flatMap((point) =>
    edge ? [point.spread] : [point.strategy, point.hodl],
  );
  const minimum = D.min(...numbers);
  const maximum = D.max(...numbers);
  const span = maximum.eq(minimum) ? new D(1) : maximum.minus(minimum);
  // Float conversion is only for chart geometry; all displayed amounts stay decimal strings.
  const plot = (key: "strategy" | "hodl" | "spread") =>
    points.map((p) => ({
      x: Date.parse(p.at),
      y: new D(p[key]).minus(minimum).div(span).times(100).toNumber(),
    }));
  return (
    <div className="stack">
      <div className="actions" aria-label="Chart series">
        <Button
          tone="outline"
          type="button"
          aria-pressed={!edge}
          onClick={() => setEdge(false)}
        >
          Wealth vs HODL
        </Button>
        <Button
          tone="outline"
          type="button"
          aria-pressed={edge}
          onClick={() => setEdge(true)}
        >
          Outperformance
        </Button>
      </div>
      <div className="chart" aria-hidden="true">
        <ResponsiveContainer width="100%" height={245} minWidth={0}>
          <ScatterChart margin={{ top: 12, left: 10, right: 22, bottom: 6 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="4 6" />
            <XAxis
              type="number"
              dataKey="x"
              domain={["dataMin - 3600000", "dataMax + 3600000"]}
              tickFormatter={(n: number) =>
                new Intl.DateTimeFormat("en", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(n)
              }
              tick={{ fill: "var(--muted)", fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 100]}
              width={114}
              tickFormatter={(n: number) =>
                equivalent(
                  minimum.plus(span.times(n).div(100)).toFixed(),
                  label,
                )
              }
              tick={{ fill: "var(--muted)", fontSize: 11 }}
            />
            {edge ? (
              <Scatter
                data={plot("spread")}
                fill="#d28b36"
                isAnimationActive={false}
              />
            ) : (
              <>
                <Scatter
                  data={plot("strategy")}
                  fill="var(--accent)"
                  isAnimationActive={false}
                  shape="circle"
                />
                <Scatter
                  data={plot("hodl")}
                  fill="#d28b36"
                  isAnimationActive={false}
                  shape="diamond"
                />
              </>
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="chart-key">
        {edge
          ? "Gold: LP minus HODL"
          : "Green circles: net strategy wealth · Gold diamonds: original HODL"}
        . Only recorded observations; timestamps on the chart are UTC.
      </p>
    </div>
  );
}
