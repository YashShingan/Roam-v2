"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Store,
  BarChart3,
  CheckCircle2,
  Phone,
  MessageCircle,
  Clock,
  Users,
  ShieldCheck,
  MapPin,
  TrendingUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Modal, cn, SPRING } from "./ui";
import type { Category, ProviderListing } from "@/lib/types";
import { CATEGORY_LABEL, CATEGORY_EMOJI } from "@/lib/catalog";

interface ProviderModalProps {
  open: boolean;
  onClose: () => void;
  city: string;
  onListingCreated?: (listing: ProviderListing) => void;
}

interface DemandRadarData {
  city: string;
  totalListings: number;
  categoryDistribution: Record<string, number>;
  kidFriendlyDemandPct: number;
  wheelchairDemandPct: number;
  suggestedPriceSweetSpot: { min: number; max: number; currency: string };
  topUnmetCategories: string[];
  marketInsight: string;
}

export function ProviderModal({ open, onClose, city, onListingCreated }: ProviderModalProps) {
  const [tab, setTab] = useState<"list" | "radar">("list");
  const [submitting, setSubmitting] = useState(false);
  const [radar, setRadar] = useState<DemandRadarData | null>(null);
  const [loadingRadar, setLoadingRadar] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("workshop");
  const [hostName, setHostName] = useState("");
  const [contactWhatsapp, setContactWhatsapp] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [pricePerPerson, setPricePerPerson] = useState<number | "">("");
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [maxGroupSize, setMaxGroupSize] = useState(8);
  const [isKidFriendly, setIsKidFriendly] = useState(true);
  const [isWheelchairAccessible, setIsWheelchairAccessible] = useState(false);
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [slotMorning, setSlotMorning] = useState(true);
  const [slotAfternoon, setSlotAfternoon] = useState(true);
  const [slotEvening, setSlotEvening] = useState(false);

  // Fetch Demand Radar data when modal opens or city changes
  useEffect(() => {
    if (!open || !city) return;
    setLoadingRadar(true);
    fetch(`/api/providers?city=${encodeURIComponent(city)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.demandRadar) setRadar(data.demandRadar);
      })
      .catch((err) => console.error("Failed to load demand radar:", err))
      .finally(() => setLoadingRadar(false));
  }, [open, city]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !hostName.trim() || !description.trim()) {
      toast.error("Please fill in Title, Host Name, and Description.");
      return;
    }

    const slots: string[] = [];
    if (slotMorning) slots.push("🌅 Morning (09:30 AM)");
    if (slotAfternoon) slots.push("☀️ Afternoon (02:30 PM)");
    if (slotEvening) slots.push("🌇 Evening (05:30 PM)");

    setSubmitting(true);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city,
          title: title.trim(),
          category,
          hostName: hostName.trim(),
          contactWhatsapp: contactWhatsapp.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
          pricePerPerson: pricePerPerson === "" ? undefined : Number(pricePerPerson),
          durationMinutes,
          maxGroupSize,
          isKidFriendly,
          isWheelchairAccessible,
          description: description.trim(),
          address: address.trim() || undefined,
          availabilitySlots: slots,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit listing");

      toast.success("Listing published! You are now live as a Verified Local Host.");
      if (onListingCreated && data.provider) {
        onListingCreated(data.provider);
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish listing");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="provider-hub-title">
      <div className="flex flex-col gap-5 p-1 max-w-2xl mx-auto">
        {/* Tab switch */}
        <div className="flex rounded-xl bg-surface/80 p-1 border border-border/50">
          <button
            type="button"
            onClick={() => setTab("list")}
            className={cn(
              "flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all",
              tab === "list" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Store size={15} />
            <span>List an Experience</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("radar")}
            className={cn(
              "flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all",
              tab === "radar" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <BarChart3 size={15} />
            <span>Traveler Demand Radar</span>
          </button>
        </div>

        {tab === "list" ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-xs">
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 flex items-start gap-2.5">
              <Sparkles size={18} className="text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">Empowering Local Guides, Artisans & Home Chefs</p>
                <p className="text-muted-foreground text-[11px] mt-0.5">
                  Publish your offering in <strong>{city}</strong>. Your listing is instantly awarded the{" "}
                  <span className="text-primary font-medium">🌟 Verified Local Host</span> badge and surfaced in traveler search and AI itineraries.
                </p>
              </div>
            </div>

            {/* Title & Category */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 flex flex-col gap-1.5">
                <label className="font-medium text-foreground">Experience / Activity Title *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Traditional Terracotta Pottery & Chai Workshop"
                  className="rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground">Category *</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="workshop">🎨 Workshop & Crafts</option>
                  <option value="food">🍲 Food & Culinary</option>
                  <option value="culture">🏛️ Heritage & Walking Tour</option>
                  <option value="adventure">🥾 Adventure & Trails</option>
                  <option value="nature">🌿 Nature & Farm Visit</option>
                  <option value="market">🛍️ Local Market Walk</option>
                  <option value="hidden_gem">✨ Hidden Gem Tour</option>
                  <option value="nightlife">🌙 Night Walk & Food Crawl</option>
                </select>
              </div>
            </div>

            {/* Host Name & Contact */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground">Host / Business Name *</label>
                <input
                  type="text"
                  required
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="e.g. Suresh & Anjali Patil"
                  className="rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground flex items-center gap-1">
                  <MessageCircle size={13} className="text-emerald-500" /> WhatsApp Number
                </label>
                <input
                  type="text"
                  value={contactWhatsapp}
                  onChange={(e) => setContactWhatsapp(e.target.value)}
                  placeholder="e.g. +91 98765 43210"
                  className="rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground flex items-center gap-1">
                  <Phone size={13} /> Calling Phone
                </label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="e.g. +91 98765 43210"
                  className="rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Price, Duration, Capacity */}
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground">Price / person (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={pricePerPerson}
                  onChange={(e) => setPricePerPerson(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="e.g. 250 (0 for free)"
                  className="rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground">Duration (minutes)</label>
                <input
                  type="number"
                  min="15"
                  step="15"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground">Max Group Size</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={maxGroupSize}
                  onChange={(e) => setMaxGroupSize(Number(e.target.value))}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Description & Address */}
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground">Experience Description *</label>
              <textarea
                required
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what travelers will experience, what is included, materials provided, or local traditions covered..."
                className="rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground">Location / Meeting Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. Studio 4, Near Gandhi Chowk, Badlapur East"
                className="rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Slots & Accessibility */}
            <div className="flex flex-col gap-2 rounded-xl bg-surface/50 p-3 border border-border/40">
              <label className="font-semibold text-foreground">Daily Availability Slots</label>
              <div className="flex flex-wrap gap-4 text-[11px]">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={slotMorning}
                    onChange={(e) => setSlotMorning(e.target.checked)}
                    className="rounded border-border text-primary"
                  />
                  <span>🌅 Morning (09:30 AM)</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={slotAfternoon}
                    onChange={(e) => setSlotAfternoon(e.target.checked)}
                    className="rounded border-border text-primary"
                  />
                  <span>☀️ Afternoon (02:30 PM)</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={slotEvening}
                    onChange={(e) => setSlotEvening(e.target.checked)}
                    className="rounded border-border text-primary"
                  />
                  <span>🌇 Evening (05:30 PM)</span>
                </label>
              </div>

              <div className="flex flex-wrap gap-4 text-[11px] pt-2 border-t border-border/30">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isKidFriendly}
                    onChange={(e) => setIsKidFriendly(e.target.checked)}
                    className="rounded border-border text-primary"
                  />
                  <span>👶 Child & Family Friendly</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isWheelchairAccessible}
                    onChange={(e) => setIsWheelchairAccessible(e.target.checked)}
                    className="rounded border-border text-primary"
                  />
                  <span>♿ Wheelchair / Step-Free Accessible</span>
                </label>
              </div>
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="default" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? "Publishing..." : "🌟 Publish as Verified Host"}
              </Button>
            </div>
          </form>
        ) : (
          /* Demand Radar / Analytics Tab */
          <div className="flex flex-col gap-4 text-xs">
            <div className="bg-surface/60 rounded-xl p-3 border border-border/50 flex items-start gap-2.5">
              <TrendingUp size={18} className="text-primary shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-foreground">Traveler Demand Radar: {city}</h4>
                <p className="text-muted-foreground text-[11px] mt-0.5">
                  Real-time analytics on traveler search behavior and unmet demand to help local providers optimize pricing and offerings.
                </p>
              </div>
            </div>

            {loadingRadar ? (
              <div className="py-8 text-center text-muted-foreground">Analyzing traveler demand signals...</div>
            ) : radar ? (
              <div className="flex flex-col gap-4">
                {/* Metric highlights */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="clay-raised-sm rounded-xl p-3 flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Active Providers</span>
                    <span className="text-xl font-bold text-foreground">{radar.totalListings}</span>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Verified hosts</span>
                  </div>
                  <div className="clay-raised-sm rounded-xl p-3 flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Price Sweet Spot</span>
                    <span className="text-base font-bold text-foreground">
                      ₹{radar.suggestedPriceSweetSpot.min}–₹{radar.suggestedPriceSweetSpot.max}
                    </span>
                    <span className="text-[10px] text-muted-foreground">Optimal traveler spend</span>
                  </div>
                  <div className="clay-raised-sm rounded-xl p-3 flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Family Demand</span>
                    <span className="text-xl font-bold text-primary">{radar.kidFriendlyDemandPct}%</span>
                    <span className="text-[10px] text-muted-foreground">Want kid-friendly stops</span>
                  </div>
                  <div className="clay-raised-sm rounded-xl p-3 flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Accessibility</span>
                    <span className="text-xl font-bold text-foreground">{radar.wheelchairDemandPct}%</span>
                    <span className="text-[10px] text-muted-foreground">Need step-free access</span>
                  </div>
                </div>

                {/* Market opportunity callout */}
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex flex-col gap-1.5">
                  <span className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
                    <Sparkles size={14} className="text-primary" /> Unmet Experience Opportunities
                  </span>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {radar.marketInsight}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {radar.topUnmetCategories.map((cat) => (
                      <span key={cat} className="rounded-full bg-background px-2.5 py-0.5 text-[10px] font-medium border border-border">
                        ⭐ High Demand: {cat.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Action button */}
                <div className="flex justify-end pt-2">
                  <Button variant="primary" onClick={() => setTab("list")}>
                    <Store size={14} /> Create Listing to Match Demand
                  </Button>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-muted-foreground">No demand data available yet for this city.</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
