"use client";

import { useState, useEffect, useCallback } from "react";
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
  Trash2,
  Eye,
  AlertTriangle,
  RefreshCw,
  Power,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Modal, cn } from "./ui";
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
  const [tab, setTab] = useState<"my_listings" | "list" | "radar">("list");
  const [submitting, setSubmitting] = useState(false);
  const [radar, setRadar] = useState<DemandRadarData | null>(null);
  const [loadingRadar, setLoadingRadar] = useState(false);

  // Host identity in localStorage
  const [savedPhone, setSavedPhone] = useState("");
  const [lookupPhoneInput, setLookupPhoneInput] = useState("");
  const [myListings, setMyListings] = useState<ProviderListing[]>([]);
  const [loadingListings, setLoadingListings] = useState(false);

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

  // Phone validation helper
  const isIndianPhoneValid = (phone: string) => {
    if (!phone) return true;
    const digits = phone.replace(/\D/g, "");
    return (
      (digits.length === 10 && /^[6-9]/.test(digits)) ||
      (digits.length === 12 && digits.startsWith("91") && /^[6-9]/.test(digits.slice(2)))
    );
  };

  // Sync phone on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("roam_host_phone") || "";
      const storedName = localStorage.getItem("roam_host_name") || "";
      if (stored) {
        setSavedPhone(stored);
        setLookupPhoneInput(stored);
        setContactWhatsapp(stored);
        setContactPhone(stored);
      }
      if (storedName) {
        setHostName(storedName);
      }
    }
  }, []);

  const loadHostListings = useCallback(async (phone: string) => {
    if (!phone) return;
    setLoadingListings(true);
    try {
      const res = await fetch(`/api/providers?hostPhone=${encodeURIComponent(phone.trim())}`);
      const data = await res.json();
      if (data.providers) {
        setMyListings(data.providers);
      }
    } catch (e) {
      console.error("Failed to load host listings", e);
    } finally {
      setLoadingListings(false);
    }
  }, []);

  useEffect(() => {
    if (open && savedPhone) {
      loadHostListings(savedPhone);
    }
  }, [open, savedPhone, loadHostListings]);

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

  const handleToggleActive = async (listingId: string, currentActive: boolean) => {
    try {
      const next = !currentActive;
      const res = await fetch("/api/providers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: listingId, isActive: next }),
      });
      if (!res.ok) throw new Error("Could not update status");
      setMyListings((prev) =>
        prev.map((item) => (item.id === listingId ? { ...item, isActive: next } : item)),
      );
      toast.success(next ? "Experience activated and visible to travelers" : "Experience paused");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle status");
    }
  };

  const handleDeleteListing = async (listingId: string) => {
    if (!confirm("Are you sure you want to remove this experience?")) return;
    try {
      const res = await fetch(`/api/providers?id=${encodeURIComponent(listingId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Could not delete listing");
      setMyListings((prev) => prev.filter((item) => item.id !== listingId));
      toast.success("Experience listing deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !hostName.trim() || !description.trim()) {
      toast.error("Please fill in Title, Host Name, and Description.");
      return;
    }

    if (contactWhatsapp && !isIndianPhoneValid(contactWhatsapp)) {
      toast.error("Please enter a valid 10-digit Indian WhatsApp number.");
      return;
    }

    const slots: string[] = [];
    if (slotMorning) slots.push("🌅 Morning (09:30 AM)");
    if (slotAfternoon) slots.push("☀️ Afternoon (02:30 PM)");
    if (slotEvening) slots.push("🌇 Evening (05:30 PM)");

    setSubmitting(true);
    try {
      const phoneToSave = contactWhatsapp.trim() || contactPhone.trim();
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
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit listing");
      }

      if (phoneToSave) {
        localStorage.setItem("roam_host_phone", phoneToSave);
        localStorage.setItem("roam_host_name", hostName.trim());
        setSavedPhone(phoneToSave);
      }

      toast.success("🌟 Listing verified by AI Trust & Safety and published!");
      if (onListingCreated && data.provider) {
        onListingCreated(data.provider);
      }
      if (phoneToSave) {
        loadHostListings(phoneToSave);
      }
      setTab("my_listings");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish listing");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="provider-hub-title">
      <div className="flex flex-col gap-4 p-1 max-w-2xl mx-auto max-h-[85vh] overflow-y-auto">
        {/* Hub Header */}
        <div className="flex items-center justify-between border-b border-border/50 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <Store size={18} />
            </div>
            <div>
              <h3 id="provider-hub-title" className="font-bold text-sm text-foreground">
                Local Host & Provider Hub
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Verified community experiences & live traveler demand in <strong>{city}</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full font-medium">
            <ShieldCheck size={13} />
            <span>AI Verified Community</span>
          </div>
        </div>

        {/* Tab switch */}
        <div className="flex rounded-xl bg-surface/80 p-1 border border-border/50">
          <button
            type="button"
            onClick={() => setTab("my_listings")}
            className={cn(
              "flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all",
              tab === "my_listings"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Users size={14} />
            <span>My Experiences & Leads</span>
            {myListings.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-background/20 text-[10px]">
                {myListings.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab("list")}
            className={cn(
              "flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all",
              tab === "list"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Store size={14} />
            <span>List an Experience</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("radar")}
            className={cn(
              "flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all",
              tab === "radar"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <BarChart3 size={14} />
            <span>Traveler Demand Radar</span>
          </button>
        </div>

        {/* TAB 1: My Listings & Leads */}
        {tab === "my_listings" && (
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex items-center gap-2 bg-surface/60 p-2.5 rounded-xl border border-border/40">
              <Phone size={14} className="text-muted-foreground" />
              <input
                type="text"
                value={lookupPhoneInput}
                onChange={(e) => setLookupPhoneInput(e.target.value)}
                placeholder="Enter host phone or WhatsApp (e.g. 9876543210)"
                className="flex-1 bg-transparent text-xs text-foreground focus:outline-none"
              />
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  if (lookupPhoneInput.trim()) {
                    setSavedPhone(lookupPhoneInput.trim());
                    localStorage.setItem("roam_host_phone", lookupPhoneInput.trim());
                    loadHostListings(lookupPhoneInput.trim());
                  }
                }}
              >
                Sync Listings
              </Button>
            </div>

            {loadingListings ? (
              <div className="py-8 text-center text-muted-foreground flex items-center justify-center gap-2">
                <RefreshCw size={14} className="animate-spin" />
                <span>Loading your verified listings...</span>
              </div>
            ) : myListings.length === 0 ? (
              <div className="py-8 text-center bg-surface/30 rounded-xl border border-dashed border-border p-6 flex flex-col items-center gap-2">
                <Store size={28} className="text-muted-foreground/60" />
                <p className="font-medium text-foreground">No listings found for this number</p>
                <p className="text-[11px] text-muted-foreground max-w-sm">
                  Publish your first workshop, food walk, or heritage tour to start welcoming travelers and getting direct WhatsApp leads.
                </p>
                <Button variant="primary" size="sm" onClick={() => setTab("list")} className="mt-2">
                  <Sparkles size={13} /> Create Listing Now
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {myListings.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl border border-border bg-surface/50 hover:bg-surface/80 transition-all flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <span className="text-base">{CATEGORY_EMOJI[item.category] || "📍"}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-foreground text-xs">{item.title}</h4>
                            {item.reviewStatus === "verified" ? (
                              <span className="inline-flex items-center gap-1 text-[9px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium px-1.5 py-0.5 rounded">
                                <CheckCircle2 size={10} /> Verified Host
                              </span>
                            ) : item.reviewStatus === "flagged" ? (
                              <span className="inline-flex items-center gap-1 text-[9px] bg-rose-500/15 text-rose-500 font-medium px-1.5 py-0.5 rounded">
                                <ShieldAlert size={10} /> Flagged
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[9px] bg-amber-500/15 text-amber-500 font-medium px-1.5 py-0.5 rounded">
                                Pending AI Review
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {CATEGORY_LABEL[item.category]} • ₹{item.pricePerPerson || 0} / person • {item.durationMinutes}m
                          </p>
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(item.id, item.isActive !== false)}
                          title={item.isActive !== false ? "Click to Pause" : "Click to Activate"}
                          className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors",
                            item.isActive !== false
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20"
                              : "bg-surface text-muted-foreground border-border hover:bg-surface/80",
                          )}
                        >
                          <Power size={11} />
                          <span>{item.isActive !== false ? "Active" : "Paused"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteListing(item.id)}
                          className="p-1 rounded-md text-muted-foreground hover:text-rose-500 transition-colors"
                          title="Delete Listing"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Traveler leads info */}
                    <div className="flex items-center justify-between pt-1.5 border-t border-border/30 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                        <MessageCircle size={12} />
                        {item.inquiriesCount || 0} Traveler Booking Inquiries
                      </span>
                      <span>{item.city} • Max {item.maxGroupSize || 8} guests</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: List an Experience */}
        {tab === "list" && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 text-xs">
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 flex items-start gap-2.5">
              <Sparkles size={16} className="text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">Empowering Local Guides, Artisans & Home Chefs</p>
                <p className="text-muted-foreground text-[11px] mt-0.5">
                  Publish your offering in <strong>{city}</strong>. Listings undergo instant automated AI safety verification to earn the{" "}
                  <span className="text-primary font-medium">🌟 Verified Local Host</span> badge and reach travelers.
                </p>
              </div>
            </div>

            {/* Title & Category */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 flex flex-col gap-1">
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

              <div className="flex flex-col gap-1">
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
              <div className="flex flex-col gap-1">
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

              <div className="flex flex-col gap-1">
                <label className="font-medium text-foreground flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <MessageCircle size={13} className="text-emerald-500" /> WhatsApp Number *
                  </span>
                  {contactWhatsapp && isIndianPhoneValid(contactWhatsapp) && (
                    <span className="text-[10px] text-emerald-500 flex items-center gap-0.5">
                      <CheckCircle2 size={10} /> Valid
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  required
                  value={contactWhatsapp}
                  onChange={(e) => setContactWhatsapp(e.target.value)}
                  placeholder="e.g. 9876543210 or +91 98765 43210"
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs focus:outline-none focus:ring-1 bg-background",
                    contactWhatsapp && !isIndianPhoneValid(contactWhatsapp)
                      ? "border-rose-400 focus:ring-rose-400"
                      : "border-border focus:ring-primary",
                  )}
                />
                {contactWhatsapp && !isIndianPhoneValid(contactWhatsapp) && (
                  <span className="text-[10px] text-rose-500">Enter a valid 10-digit Indian phone</span>
                )}
              </div>

              <div className="flex flex-col gap-1">
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
              <div className="flex flex-col gap-1">
                <label className="font-medium text-foreground">Price / person (₹)</label>
                <input
                  type="number"
                  min="0"
                  max="25000"
                  step="50"
                  value={pricePerPerson}
                  onChange={(e) => setPricePerPerson(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="e.g. 250 (0 for free)"
                  className="rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex flex-col gap-1">
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

              <div className="flex flex-col gap-1">
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
            <div className="flex flex-col gap-1">
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

            <div className="flex flex-col gap-1">
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
            <div className="flex flex-col gap-2 rounded-xl bg-surface/50 p-2.5 border border-border/40">
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

              <div className="flex flex-wrap gap-4 text-[11px] pt-1.5 border-t border-border/30">
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

            {/* Live Card Preview */}
            {title && (
              <div className="rounded-xl border border-border/60 bg-surface/40 p-2.5 flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                  <Eye size={12} /> Live Traveler Card Preview
                </span>
                <div className="flex items-start justify-between gap-2 bg-background p-2 rounded-lg border border-border/40">
                  <div className="flex items-start gap-2">
                    <span className="text-lg">{CATEGORY_EMOJI[category]}</span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs text-foreground">{title}</span>
                        <span className="text-[9px] bg-primary/10 text-primary font-medium px-1.5 py-0.2 rounded">
                          🌟 Verified Host
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                        {description || "Authentic local experience..."}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-bold text-xs text-foreground">
                      ₹{pricePerPerson === "" ? 0 : pricePerPerson}
                    </span>
                    <span className="text-[10px] text-muted-foreground block">{durationMinutes}m</span>
                  </div>
                </div>
              </div>
            )}

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
              <Button type="button" variant="default" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? (
                  <span className="flex items-center gap-1.5">
                    <RefreshCw size={13} className="animate-spin" /> Verifying with AI Guardian...
                  </span>
                ) : (
                  "🌟 Publish as Verified Host"
                )}
              </Button>
            </div>
          </form>
        )}

        {/* TAB 3: Demand Radar / Analytics Tab */}
        {tab === "radar" && (
          <div className="flex flex-col gap-3 text-xs">
            <div className="bg-surface/60 rounded-xl p-3 border border-border/50 flex items-start gap-2.5">
              <TrendingUp size={16} className="text-primary shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-foreground">Traveler Demand Radar: {city}</h4>
                <p className="text-muted-foreground text-[11px] mt-0.5">
                  Real-time analytics on traveler search behavior and unmet demand to help local providers optimize pricing and offerings.
                </p>
              </div>
            </div>

            {loadingRadar ? (
              <div className="py-8 text-center text-muted-foreground flex items-center justify-center gap-2">
                <RefreshCw size={14} className="animate-spin" />
                <span>Analyzing traveler demand signals...</span>
              </div>
            ) : radar ? (
              <div className="flex flex-col gap-3">
                {/* Metric highlights */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="clay-raised-sm rounded-xl p-2.5 flex flex-col gap-0.5">
                    <span className="text-[9px] text-muted-foreground uppercase font-semibold">Active Providers</span>
                    <span className="text-lg font-bold text-foreground">{radar.totalListings}</span>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Verified hosts</span>
                  </div>
                  <div className="clay-raised-sm rounded-xl p-2.5 flex flex-col gap-0.5">
                    <span className="text-[9px] text-muted-foreground uppercase font-semibold">Price Sweet Spot</span>
                    <span className="text-base font-bold text-foreground">
                      ₹{radar.suggestedPriceSweetSpot.min}–₹{radar.suggestedPriceSweetSpot.max}
                    </span>
                    <span className="text-[10px] text-muted-foreground">Optimal traveler spend</span>
                  </div>
                  <div className="clay-raised-sm rounded-xl p-2.5 flex flex-col gap-0.5">
                    <span className="text-[9px] text-muted-foreground uppercase font-semibold">Family Demand</span>
                    <span className="text-lg font-bold text-primary">{radar.kidFriendlyDemandPct}%</span>
                    <span className="text-[10px] text-muted-foreground">Want kid-friendly stops</span>
                  </div>
                  <div className="clay-raised-sm rounded-xl p-2.5 flex flex-col gap-0.5">
                    <span className="text-[9px] text-muted-foreground uppercase font-semibold">Accessibility</span>
                    <span className="text-lg font-bold text-foreground">{radar.wheelchairDemandPct}%</span>
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
                  <Button variant="primary" size="sm" onClick={() => setTab("list")}>
                    <Store size={13} /> Create Listing to Match Demand
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
