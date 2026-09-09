"use client";

import { animate, motion } from "framer-motion";
import { CloudSun, MapPin, Sparkles, Sunrise, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { CityStats } from "@/lib/types";
import { translate, type DictKey } from "@/lib/i18n";
import { useRoam } from "@/lib/store";
import { Skeleton } from "./ui";

function CountUp({ value, suffix }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const ctrl = animate(0, value, {
      duration: 1.2,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => ctrl.stop();
  }, [value]);
  return (
    <span>
      {Intl.NumberFormat("en", { notation: "compact" }).format(display)}
      {suffix}
    </span>
  );
}

export interface WeatherLite {
  tempC: number;
  label: string;
  emoji: string;
  sunset: string;
  sunrise: string;
  goldenHour: boolean;
}

export function Hero({
  cityLabel,
  stats,
  weather,
  sourcesOk,
  sourcesTotal,
  onOpenCity,
}: {
  cityLabel: string;
  stats?: CityStats;
  weather?: WeatherLite;
  sourcesOk: number;
  sourcesTotal: number;
  onOpenCity: () => void;
}) {
  const lang = useRoam((s) => s.lang);
  const t = (k: DictKey) => translate(lang, k);
  const hour = new Date().getHours();
  const greetingKey: DictKey =
    hour < 5
      ? "hero.greeting.night"
      : hour < 12
        ? "hero.greeting.morning"
        : hour < 17
          ? "hero.greeting.afternoon"
          : hour < 22
            ? "hero.greeting.evening"
            : "hero.greeting.night";

  return (
    <header className="relative overflow-hidden px-4 pt-6 pb-4 sm:px-6 sm:pt-8 sm:pb-5">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="animate-blob absolute -top-20 -left-16 h-64 w-64 rounded-full bg-primary/15 blur-2xl" />
        <div className="animate-blob absolute top-10 right-0 h-52 w-52 rounded-full bg-accent/15 blur-2xl [animation-delay:-6s]" />
        <div className="animate-blob absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-gold/10 blur-2xl [animation-delay:-3s]" />
      </div>

      <div className="relative mx-auto max-w-6xl">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
          <button
            onClick={onOpenCity}
            className="clay-raised-sm inline-flex items-center gap-2 px-4 h-10 text-sm font-semibold hover:clay-lift"
            aria-label={`Change city — currently ${cityLabel}`}
          >
            <MapPin size={15} className="text-primary" />
            {cityLabel.split(",").slice(0, 2).join(",")}
          </button>
          <h1 className="mt-3 text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-balance leading-tight">
            {t(greetingKey)}
            <span className="text-primary">.</span>
          </h1>
          <p className="mt-1 sm:mt-1.5 text-[13px] sm:text-sm lg:text-base text-muted-foreground max-w-xl leading-relaxed">{t("app.tagline")}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08 }}
          className="mt-3 sm:mt-4 flex items-center gap-2 sm:gap-2.5 overflow-x-auto hide-scrollbar scroll-fade pb-1"
        >
          <WeatherChip data={weather} />
          <StatPill
            icon={<Sparkles size={14} className="text-primary" />}
            value={stats ? <CountUp value={stats.total} /> : "…"}
            label={t("hero.stats.places")}
          />
          <StatPill
            icon={<CloudSun size={14} className="text-accent" />}
            value={sourcesTotal > 0 ? <CountUp value={sourcesOk} suffix={`/${sourcesTotal}`} /> : "…"}
            label={t("hero.stats.sources")}
          />
          <StatPill
            icon={<TrendingUp size={14} className="text-gold" />}
            value={stats ? <CountUp value={stats.mentionsTotal} /> : "…"}
            label={t("hero.stats.mentions")}
          />
        </motion.div>

        <div className="clay-raised mt-3 sm:mt-5 flex items-center gap-3 overflow-hidden px-3 sm:px-4 py-2 sm:py-2.5" aria-label={t("hero.trending")}>
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-primary">
            {t("hero.trending")}
          </span>
          <div className="relative flex-1 overflow-hidden">
            <div className="animate-marquee flex w-max gap-8 whitespace-nowrap text-[13px] text-muted-foreground">
              {[0, 1].map((copy) => (
                <div key={copy} className="flex gap-8" aria-hidden={copy === 1}>
                  {(stats?.topMentioned.length
                    ? stats.topMentioned.map((m) => `🗣 ${m.name} ×${m.mentions}`)
                    : ["Overpass (OSM)", "Wikipedia", "Wikidata", "Wikivoyage", "Reddit", "Commons", "GeoNames", "Photon"]
                  ).map((item, i) => (
                    <span key={`${copy}-${i}`}>{item}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function StatPill({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: string }) {
  return (
    <div className="clay-raised-sm flex items-center gap-2 sm:gap-2.5 px-3 sm:px-4 h-10 sm:h-11 shrink-0">
      {icon}
      <span className="text-base font-bold leading-none">{value}</span>
      <span className="text-[11px] text-muted-foreground leading-tight">{label}</span>
    </div>
  );
}

export function WeatherChip({ data }: { data?: WeatherLite }) {
  if (!data) {
    return (
      <div className="clay-raised-sm flex items-center gap-2 px-4 h-11">
        <Skeleton className="h-4 w-36" />
      </div>
    );
  }
  return (
    <div
      className="clay-raised-sm flex items-center gap-2 sm:gap-2.5 px-3 sm:px-4 h-10 sm:h-11 text-[13px] sm:text-sm shrink-0"
      title={`${data.label} · sunrise ${data.sunrise} · sunset ${data.sunset}`}
    >
      <span className="text-base" aria-hidden>
        {data.emoji}
      </span>
      <span className="font-bold">{data.tempC}°C</span>
      <span className="text-muted-foreground hidden sm:inline">{data.label}</span>
      <span className="flex items-center gap-1 text-muted-foreground border-l border-border pl-2.5">
        <Sunrise size={13} className="text-gold" />
        {data.sunset}
      </span>
      {data.goldenHour && (
        <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-bold text-gold">golden hour</span>
      )}
    </div>
  );
}
