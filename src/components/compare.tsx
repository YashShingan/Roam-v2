"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { Experience } from "@/lib/types";
import { useRoam } from "@/lib/store";
import { Button, Modal, cn, SPRING } from "./ui";
import { CATEGORY_EMOJI } from "./cards";
import { CATEGORY_LABEL } from "./filters";

type Row = {
  label: string;
  value: (e: Experience) => string;
  num?: (e: Experience) => number;
  better?: "high" | "low";
};

const ROWS: Row[] = [
  { label: "Category", value: (e) => CATEGORY_LABEL[e.category] },
  { label: "Price / person", value: (e) => (e.pricePerPerson === 0 ? "Free" : `₹${e.pricePerPerson}${e.priceIsEstimate ? " est." : ""}`), num: (e) => e.pricePerPerson ?? 9999, better: "low" },
  { label: "Typical visit", value: (e) => `${e.durationMinutes} min`, num: (e) => e.durationMinutes, better: undefined },
  { label: "Community mentions", value: (e) => String(e.community.mentions), num: (e) => e.community.mentions, better: "high" },
  { label: "Sentiment", value: (e) => (e.community.sentiment === 0 ? "no signal" : `${e.community.sentiment > 0 ? "+" : ""}${e.community.sentiment}`), num: (e) => e.community.sentiment, better: "high" },
  { label: "Upvotes", value: (e) => String(e.community.upvotes), num: (e) => e.community.upvotes, better: "high" },
  { label: "Open hours", value: (e) => e.openingHoursRaw ?? "Not listed" },
  { label: "Best time", value: (e) => e.bestTime ?? "Flexible" },
  { label: "Outdoor", value: (e) => (e.isOutdoor ? "🌤 yes" : "🏛 indoor-ish") },
  { label: "Wheelchair", value: (e) => (e.wheelchairAccessible === true ? "♿ yes" : e.wheelchairAccessible === false ? "limited" : "unlisted") },
  { label: "Sources", value: (e) => e.sources.map((s) => s.source).join(" + ") },
];

export function CompareSheet({
  open,
  onClose,
  places,
  onOpenPlace,
}: {
  open: boolean;
  onClose: () => void;
  places: Experience[];
  onOpenPlace: (e: Experience) => void;
}) {
  const compare = useRoam((s) => s.compare);
  const toggleCompare = useRoam((s) => s.toggleCompare);
  const selected = compare.map((id) => places.find((p) => p.id === id)).filter((p): p is Experience => !!p);

  const bestIn = (row: Row): Set<string> => {
    const out = new Set<string>();
    if (!row.num || !row.better || selected.length < 2) return out;
    const nums = selected.map((e) => row.num!(e));
    const best = row.better === "high" ? Math.max(...nums) : Math.min(...nums);
    if (best === Math.min(...nums) && best === Math.max(...nums)) return out;
    selected.forEach((e, i) => {
      if (row.num!(e) === best) out.add(e.id);
    });
    return out;
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="compare-title" wide>
      <div className="thin-scroll max-h-[92dvh] overflow-y-auto p-5">
        <h2 id="compare-title" className="text-lg font-bold">⚖️ Side-by-side</h2>
        <p className="text-[13px] text-muted-foreground">Pick up to 3 places from cards (⇄ button). Best-in-metric rows are tinted.</p>

        {selected.length === 0 ? (
          <div className="clay-raised mt-4 p-8 text-center text-sm text-muted-foreground">
            Nothing selected yet — tap the <span className="font-bold">⇄</span> toggle on any card.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[540px] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th className="w-32" />
                  {selected.map((e) => (
                    <th key={e.id} className="clay-raised-sm p-3 text-left align-top">
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => onOpenPlace(e)} className="text-left font-bold leading-tight hover:text-primary">
                          {CATEGORY_EMOJI[e.category]} {e.name}
                        </button>
                        <button onClick={() => toggleCompare(e.id)} aria-label={`Remove ${e.name}`} className="text-muted-foreground hover:text-red-400">
                          <X size={14} />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row, ri) => {
                  const best = bestIn(row);
                  return (
                    <tr key={row.label} className={ri % 2 === 0 ? "bg-surface/50" : ""}>
                      <td className="rounded-l-xl px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{row.label}</td>
                      {selected.map((e) => (
                        <td key={e.id} className={cn("px-3 py-2 font-medium", best.has(e.id) && "rounded-xl bg-accent/15 text-accent")}>
                          {row.value(e)}
                          {best.has(e.id) && <span className="ml-1 text-[10px]">★</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Floating spring bar shown when ≥1 place is in compare. */
export function CompareTray({ places, onOpen }: { places: Experience[]; onOpen: () => void }) {
  const compare = useRoam((s) => s.compare);
  const toggleCompare = useRoam((s) => s.toggleCompare);
  const clearCompare = useRoam((s) => s.clearCompare);
  const selected = compare.map((id) => places.find((p) => p.id === id)).filter((p): p is Experience => !!p);
  return (
    <AnimatePresence>
      {selected.length > 0 && (
        <motion.div
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={SPRING}
          className="clay-dock fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 px-3 py-2 no-print"
          role="status"
        >
          {selected.map((e) => (
            <span key={e.id} className="clay-raised-sm flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold">
              {CATEGORY_EMOJI[e.category]} {e.name.length > 16 ? `${e.name.slice(0, 15)}…` : e.name}
              <button onClick={() => toggleCompare(e.id)} aria-label={`Remove ${e.name}`} className="text-muted-foreground hover:text-red-400">
                <X size={12} />
              </button>
            </span>
          ))}
          <Button size="sm" variant="primary" onClick={onOpen} disabled={selected.length < 2}>
            Compare {selected.length}
          </Button>
          <Button size="sm" variant="ghost" onClick={clearCompare} aria-label="Clear comparison">
            <X size={14} />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
