"use client";

import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Calendar,
  ChevronDown,
  Clock,
  DollarSign,
  ExternalLink,
  Eye,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Quote,
  Share2,
  ShieldCheck,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Experience } from "@/lib/types";
import { translate, type DictKey } from "@/lib/i18n";
import { useRoam } from "@/lib/store";
import { download, icsForPlace } from "@/lib/exports";
import { Button, Modal, cn, SPRING } from "./ui";
import { CATEGORY_EMOJI } from "./cards";
import { CATEGORY_LABEL } from "./filters";
import { HeatStrip } from "./ui";

interface WikiEnrich {
  extract?: string | null;
  thumbnail?: string;
  url?: string;
  note?: string;
}

export function DetailDialog({
  exp,
  open,
  onClose,
  onAddToTrip,
}: {
  exp: Experience | null;
  open: boolean;
  onClose: () => void;
  onAddToTrip: (exp: Experience) => void;
}) {
  const lang = useRoam((s) => s.lang);
  const t = (k: DictKey) => translate(lang, k);
  const [showSources, setShowSources] = useState(false);
  const [extra, setExtra] = useState<WikiEnrich | null>(null);

  const wiki = useMutation({
    mutationFn: async (): Promise<WikiEnrich> => {
      const res = await fetch(
        `/api/places/${encodeURIComponent(exp?.id ?? "")}/wiki?lat=${exp?.lat ?? ""}&lon=${exp?.lon ?? ""}&name=${encodeURIComponent(exp?.name ?? "")}`,
      );
      if (!res.ok) throw new Error("wiki unavailable");
      return (await res.json()) as WikiEnrich;
    },
    onSuccess: (d) => {
      if (d.extract) toast.success("Wikipedia description added");
      else toast.message("No matching Wikipedia article found");
    },
    onError: () => toast.error("Wikipedia enrichment failed — the source may be down"),
  });

  useEffect(() => {
    if (exp) useRoam.getState().pushRecent(exp.id);
  }, [exp]);

  if (!exp) return null;

  const fmt = (v: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(v / 10) * 10);

  const priceValue = exp.priceHint
    ? exp.priceHint.min === exp.priceHint.max
      ? `${fmt(exp.priceHint.min)} (${exp.priceHint.mode})`
      : `${fmt(exp.priceHint.min)}–${fmt(exp.priceHint.max).replace("₹", "")} (${exp.priceHint.mode})`
    : exp.pricePerPerson !== undefined && exp.pricePerPerson !== null
      ? exp.pricePerPerson === 0
        ? "Free entry"
        : `${fmt(exp.pricePerPerson)} (est.)`
      : "Varies — no reliable signal";

  const facts: { icon: React.ReactNode; label: string; value: React.ReactNode }[] = [
    {
      icon: <DollarSign size={14} />,
      label: "Price / person",
      value: priceValue,
    },
    { icon: <Clock size={14} />, label: "Typical visit", value: `${exp.durationMinutes} min` },
    {
      icon: <MapPin size={14} />,
      label: "Address",
      value: (
        <span className="block">
          <span className="block line-clamp-2">{exp.address || "Unlisted"}</span>
          {exp.lat !== undefined && exp.lon !== undefined && (
            <a
              href={exp.gmapsDirectionsUrl ?? `https://www.google.com/maps/dir/?api=1&destination=${exp.lat},${exp.lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
            >
              <Navigation size={10} /> Open directions
            </a>
          )}
        </span>
      ),
    },
    { icon: <Calendar size={14} />, label: "Hours", value: exp.openingHoursRaw ?? "Not listed" },
    {
      icon: <Eye size={14} />,
      label: "Best time",
      value: exp.bestTime ?? "Flexible",
    },
    {
      icon: <ShieldCheck size={14} />,
      label: "Access",
      value: [
        exp.wheelchairAccessible === true ? "♿ wheelchair ok" : exp.wheelchairAccessible === false ? "♿ limited" : null,
        exp.goodForKids === true ? "🧒 kid-friendly" : null,
        exp.isOutdoor ? "🌤 outdoor" : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Unlisted",
    },
  ];

  return (
    <Modal open={open} onClose={onClose} labelledBy="detail-title" wide>
      <div className="thin-scroll overflow-y-auto max-h-[95dvh] sm:max-h-[88dvh]">
        {/* hero */}
        <div className="relative h-52 w-full bg-surface sm:h-64">
          {exp.imageUrl ? (
            <Image src={exp.imageUrl} alt={exp.name} fill sizes="(max-width:768px) 100vw, 700px" className="object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-7xl opacity-50">{CATEGORY_EMOJI[exp.category]}</div>
          )}
          {exp.photoAttribution && (
            <div className="absolute top-3 left-3 z-10 rounded-full bg-black/65 px-3 py-1 text-[11px] font-medium text-white/95 backdrop-blur shadow-sm">
              📷 {exp.photoAttribution}
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-5 pt-14">
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
              {CATEGORY_LABEL[exp.category]}
            </span>
            <h2 id="detail-title" className="mt-1.5 text-2xl font-bold text-white sm:text-3xl">
              {exp.name}
            </h2>
            <p className="text-sm text-white/80">{exp.popularity}</p>
          </div>
        </div>

        <div className="space-y-4 sm:space-y-5 p-4 sm:p-5">
          {/* description + wiki enrichment */}
          <section>
            <p className="text-[15px] leading-relaxed">
              {exp.description ?? (
                <span className="text-muted-foreground">
                  No description yet from the open sources.
                  {exp.lat !== undefined && (
                    <>
                      {" "}
                      <button
                        onClick={() => wiki.mutate()}
                        disabled={wiki.isPending}
                        className="font-semibold text-primary underline underline-offset-2"
                      >
                        {wiki.isPending ? "Asking Wikipedia…" : t("detail.wikiEnrich")}
                      </button>
                      .
                    </>
                  )}
                </span>
              )}
            </p>
            {extra?.extract && <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{extra.extract}</p>}
            {wiki.data?.extract && exp.description && (
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{wiki.data.extract}</p>
            )}
          </section>

          {/* best time widget */}
          <section className="clay-raised-sm flex items-center justify-between gap-4 p-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Best time to go</p>
              <p className="mt-0.5 text-sm font-semibold">{exp.bestTime ?? "Flexible"}</p>
              {exp.goldenHour && (
                <p className="mt-0.5 text-[12px] text-gold font-semibold">✨ Golden hour spot — plan around sunset</p>
              )}
            </div>
            <HeatStrip bestTime={exp.bestTime} golden={exp.goldenHour} />
          </section>

          {/* quotes */}
          {exp.community.quotes.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                <Quote size={14} className="text-primary" /> {t("detail.quotes")}
              </h3>
              <div className="space-y-2">
                {exp.community.quotes.slice(0, 4).map((q, i) => (
                  <motion.blockquote
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SPRING, delay: i * 0.06 }}
                    className="rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 p-3.5 text-[13px] leading-relaxed"
                  >
                    “{q.text.length > 260 ? `${q.text.slice(0, 260)}…` : q.text}”
                    {q.permalink && (
                      <a
                        href={q.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:underline"
                      >
                        source <ExternalLink size={10} />
                      </a>
                    )}
                  </motion.blockquote>
                ))}
              </div>
            </section>
          )}

          {/* facts grid */}
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {facts.map((f) => (
              <div key={f.label} className="clay-raised-sm p-3">
                <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {f.icon} {f.label}
                </p>
                <p className="mt-1 text-[13px] font-semibold leading-snug">{f.value}</p>
              </div>
            ))}
          </section>

          {/* amenities */}
          {exp.amenities.length > 0 && (
            <section className="flex flex-wrap gap-1.5">
              {exp.amenities.map((a) => (
                <span key={a} className="rounded-full bg-accent/12 px-2.5 py-1 text-[11px] font-semibold text-accent">
                  {a}
                </span>
              ))}
            </section>
          )}

          {/* tags */}
          {exp.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {exp.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-surface px-2.5 py-1 text-[11px] text-muted-foreground">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* source transparency */}
          <section className="overflow-hidden rounded-2xl border border-border">
            <button
              onClick={() => setShowSources(!showSources)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-bold hover:bg-surface transition-colors"
              aria-expanded={showSources}
            >
              <span className="flex items-center gap-2">
                <BookOpen size={15} className="text-accent" /> {t("detail.sources")}
                <span className="text-muted-foreground font-normal">({exp.sources.length} sources)</span>
              </span>
              <ChevronDown size={16} className={cn("transition-transform", showSources && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
              {showSources && (
                <motion.ul
                  initial={{ height: 0 }}
                  animate={{ height: "auto" }}
                  exit={{ height: 0 }}
                  className="divide-y divide-border overflow-hidden bg-surface/40 text-[13px]"
                >
                  {exp.sources.map((s, i) => (
                    <li key={i} className="px-4 py-2.5">
                      <p className="font-semibold">{s.source}</p>
                      {s.note && <p className="text-muted-foreground">{s.note}</p>}
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">
                          open original record <ExternalLink size={11} />
                        </a>
                      )}
                    </li>
                  ))}
                  <li className="px-4 py-2.5 text-[11px] text-muted-foreground">
                    Aggregated from keyless open APIs. Nothing is fabricated — an absent signal stays absent. Map data © OpenStreetMap contributors (ODbL).
                  </li>
                </motion.ul>
              )}
            </AnimatePresence>
          </section>

          {/* actions */}
          <section className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => onAddToTrip(exp)}>
              <Plus size={15} /> {t("detail.addToTrip")}
            </Button>
            <a
              href={exp.gmapsDirectionsUrl ?? (exp.lat !== undefined && exp.lon !== undefined ? `https://www.google.com/maps/dir/?api=1&destination=${exp.lat},${exp.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(exp.name + ' ' + (exp.address || ''))}`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="accent" className="font-bold shadow-sm">
                <Navigation size={15} /> Directions (Google Maps)
              </Button>
            </a>
            <Button onClick={() => download(`${exp.name.replaceAll(/\W+/g, "-")}.ics`, icsForPlace(exp), "text/calendar")}>
              <Calendar size={15} /> .ics
            </Button>
            <Button
              onClick={() => {
                navigator.clipboard
                  ?.writeText(`${exp.name} — ${exp.gmapsDirectionsUrl ?? exp.gmapsUrl ?? exp.address}`)
                  .then(() => toast.success("Copied"))
                  .catch(() => toast.error("Clipboard unavailable"));
              }}
            >
              <Share2 size={15} /> Share
            </Button>
            {exp.website && (
              <a href={exp.website} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost">
                  <ExternalLink size={15} /> Website
                </Button>
              </a>
            )}
            {exp.gmapsUrl && (
              <a href={exp.gmapsUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost">📍 Google Maps</Button>
              </a>
            )}
            {exp.osmType && exp.osmId && (
              <a
                href={`https://www.openstreetmap.org/edit?${exp.osmType}=${exp.osmId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="ghost">
                  <Pencil size={14} /> {t("detail.suggestEdit")}
                </Button>
              </a>
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
}
