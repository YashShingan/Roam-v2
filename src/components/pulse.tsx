"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CityStats, Experience } from "@/lib/types";
import { CATEGORY_LABEL } from "./filters";

type TooltipFormatter = NonNullable<React.ComponentProps<typeof Tooltip>["formatter"]>;

const fmtPercent = ((value: unknown, name: unknown): [string, string] => [
  `${Math.round(Number(value) * 100)}%`,
  String(name),
]) as TooltipFormatter;

const PIE_COLORS = ["#D96B43", "#7A9A7B", "#D9A441", "#8C5BA8", "#5460C8", "#3F8FA8", "#A8683F", "#5B9E63", "#C2603F", "#4E8E5B"];

export function PulseView({
  stats,
  places,
  onBarClick,
  onPieClick,
}: {
  stats?: CityStats;
  places: Experience[];
  onBarClick: (name: string) => void;
  onPieClick: (source: string) => void;
}) {
  const sentiment = useMemo(
    () =>
      stats?.sentimentHistogram.map((s) => ({
        ...s,
        bucket: s.bucket.replace("very ", "very "),
      })) ?? [],
    [stats],
  );
  const radar = useMemo(() => stats?.radar ?? [], [stats]);
  const sources = useMemo(() => stats?.sourceCounts.slice(0, 7) ?? [], [stats]);
  const top = useMemo(() => stats?.topMentioned ?? [], [stats]);

  if (!stats && places.length === 0) {
    return <p className="clay-raised p-6 text-sm text-muted-foreground">Load a city to see its community pulse.</p>;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Radar: signal × variety per category */}
      <section className="clay-raised p-5">
        <h3 className="text-sm font-bold">Category radar</h3>
        <p className="mb-2 text-[12px] text-muted-foreground">How deep the community signal runs in each category.</p>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <RadarChart data={radar} outerRadius="72%">
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="category" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <Radar dataKey="signal" stroke="#D96B43" fill="#D96B43" fillOpacity={0.35} isAnimationActive />
              <Radar dataKey="variety" stroke="#7A9A7B" fill="#7A9A7B" fillOpacity={0.25} isAnimationActive />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
                formatter={fmtPercent}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Bars: top mentioned (click → search) */}
      <section className="clay-raised p-5">
        <h3 className="text-sm font-bold">Most mentioned</h3>
        <p className="mb-2 text-[12px] text-muted-foreground">Click a bar to search for that place.</p>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={top} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fill: "var(--foreground)", fontSize: 11 }}
                tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
              />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
              <Bar
                dataKey="mentions"
                fill="#D96B43"
                radius={[0, 8, 8, 0]}
                cursor="pointer"
                isAnimationActive
                onClick={(e: { name?: string }) => e?.name && onBarClick(e.name)}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Donut: source mix (click → filter by source) */}
      <section className="clay-raised p-5">
        <h3 className="text-sm font-bold">Where the signal comes from</h3>
        <p className="mb-2 text-[12px] text-muted-foreground">Open sources contributing places right now.</p>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={sources}
                dataKey="count"
                nameKey="source"
                innerRadius="52%"
                outerRadius="80%"
                paddingAngle={3}
                isAnimationActive
                onClick={(data: unknown) => {
                  const source = (data as { payload?: { source?: string } })?.payload?.source;
                  if (source) onPieClick(source);
                }}
                cursor="pointer"
              >
                {sources.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="var(--card)" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sources.map((s, i) => (
            <button
              key={s.source}
              onClick={() => onPieClick(s.source)}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold hover:brightness-95"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              {s.source} · {s.count}
            </button>
          ))}
        </div>
      </section>

      {/* Sentiment histogram */}
      <section className="clay-raised p-5">
        <h3 className="text-sm font-bold">Sentiment histogram</h3>
        <p className="mb-2 text-[12px] text-muted-foreground">
          Tone of {stats?.mentionsTotal ?? 0} community mentions. Neutral means “not enough signal” — never invented.
        </p>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={sentiment}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} interval={0} />
              <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="count" radius={[8, 8, 0, 0]} isAnimationActive>
                {sentiment.map((s, i) => (
                  <Cell
                    key={i}
                    fill={
                      s.bucket.includes("very negative")
                        ? "#B0452F"
                        : s.bucket.includes("negative")
                          ? "#C2603F"
                          : s.bucket.includes("positive")
                            ? "#7A9A7B"
                            : s.bucket.includes("very positive")
                              ? "#4E8E5B"
                              : "#B9B0A2"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {stats?.avgPrice !== undefined && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Average estimated spend: <span className="font-bold text-foreground">₹{stats.avgPrice}</span> per person across categories.
          </p>
        )}
      </section>
    </div>
  );
}
