"use client";

import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Calendar,
  CalendarCheck,
  ChevronDown,
  Clock,
  DollarSign,
  ExternalLink,
  Eye,
  Flag,
  MapPin,
  MessageCircle,
  Navigation,
  Pencil,
  Phone,
  Plus,
  Quote,
  Send,
  Share2,
  ShieldCheck,
  CheckCircle2,
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

  // Booking drawer state
  const [showBookingDrawer, setShowBookingDrawer] = useState(false);
  const [bookingDate, setBookingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bookingSlot, setBookingSlot] = useState("");
  const [bookingGuests, setBookingGuests] = useState(2);
  const [sendingInquiry, setSendingInquiry] = useState(false);

  // Report state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("Inaccurate or outdated details");
  const [submittingReport, setSubmittingReport] = useState(false);

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
    if (exp) {
      useRoam.getState().pushRecent(exp.id);
      if (exp.availabilitySlots && exp.availabilitySlots.length > 0) {
        setBookingSlot(exp.availabilitySlots[0]);
      } else {
        setBookingSlot("Morning (10:00 AM)");
      }
    }
  }, [exp]);

  // Dispatch Roamy curious peek event when detail opens
  useEffect(() => {
    if (exp && open && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("roam:place-inspect", {
          detail: { placeName: exp.name, category: exp.category },
        }),
      );
    }
  }, [exp, open]);

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

  const handleBookingSubmit = async () => {
    if (!exp.contactWhatsapp && !exp.contactPhone) {
      toast.error("Host contact is not available for direct booking.");
      return;
    }

    setSendingInquiry(true);
    try {
      // 1. Record lead inquiry in DB
      await fetch("/api/providers/inquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: exp.id }),
      }).catch((e) => console.warn("Failed to record inquiry:", e));

      // 2. Open WhatsApp handoff
      const targetPhone = (exp.contactWhatsapp || exp.contactPhone || "").replace(/\D/g, "");
      const msg = `Hi ${exp.hostName || "Host"}, I would like to request a booking slot for "${exp.name}" on ${bookingDate} (${bookingSlot}) for ${bookingGuests} guest(s). Is this slot available?`;
      const url = `https://wa.me/${targetPhone}?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");

      toast.success("Lead inquiry sent! WhatsApp conversation opened.");
      setShowBookingDrawer(false);
    } catch {
      toast.error("Failed to connect to host");
    } finally {
      setSendingInquiry(false);
    }
  };

  const handleReportSubmit = async () => {
    setSubmittingReport(true);
    try {
      const res = await fetch("/api/providers/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: exp.id, reason: reportReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit report");

      if (data.flagged) {
        toast.warning("This listing has been suspended from Roam pending Trust & Safety review.");
        onClose();
      } else {
        toast.success("Thank you for helping keep Roam safe. Your report has been recorded.");
        setShowReportModal(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to report listing");
    } finally {
      setSubmittingReport(false);
    }
  };

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

          {/* Local Host Contact & Booking Section */}
          {exp.isLocalHost && (
            <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-bold text-primary text-xs uppercase tracking-wider">
                  🌟 Verified Local Host Experience
                </span>
                {exp.hostName && <span className="text-xs font-semibold text-foreground">Host: {exp.hostName}</span>}
              </div>

              {exp.availabilitySlots && exp.availabilitySlots.length > 0 && (
                <div className="flex flex-wrap gap-1.5 items-center text-xs">
                  <span className="text-muted-foreground font-medium">Daily Slots:</span>
                  {exp.availabilitySlots.map((s, idx) => (
                    <span key={idx} className="rounded-md bg-background px-2 py-0.5 border border-border text-[11px] font-semibold">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {/* Booking Drawer Toggle / Handoff */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  variant="primary"
                  onClick={() => setShowBookingDrawer(!showBookingDrawer)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm"
                >
                  <CalendarCheck size={14} /> Request Booking Slot
                </Button>
                {exp.contactWhatsapp && (
                  <a
                    href={`https://wa.me/${exp.contactWhatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi ${exp.hostName || "Host"}, I found your experience "${exp.name}" on Roam and would like to check availability!`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="default" className="text-xs gap-1.5">
                      <MessageCircle size={14} className="text-emerald-500" /> Quick WhatsApp
                    </Button>
                  </a>
                )}
                {exp.contactPhone && (
                  <a href={`tel:${exp.contactPhone}`}>
                    <Button variant="ghost" className="text-xs gap-1.5 text-muted-foreground">
                      <Phone size={13} /> Call
                    </Button>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setShowReportModal(true)}
                  className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-rose-500 transition-colors p-1"
                  title="Report inaccurate or suspicious listing"
                >
                  <Flag size={12} />
                  <span>Report</span>
                </button>
              </div>

              {/* Inline Booking Request Drawer */}
              <AnimatePresence>
                {showBookingDrawer && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-2 p-3 rounded-xl bg-background border border-border/80 flex flex-col gap-2.5 text-xs shadow-sm"
                  >
                    <h4 className="font-semibold text-foreground flex items-center gap-1.5">
                      <CalendarCheck size={14} className="text-primary" /> Request a Slot with Host
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Date</label>
                        <input
                          type="date"
                          value={bookingDate}
                          onChange={(e) => setBookingDate(e.target.value)}
                          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Time Slot</label>
                        <select
                          value={bookingSlot}
                          onChange={(e) => setBookingSlot(e.target.value)}
                          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          {exp.availabilitySlots && exp.availabilitySlots.length > 0 ? (
                            exp.availabilitySlots.map((s, idx) => (
                              <option key={idx} value={s}>
                                {s}
                              </option>
                            ))
                          ) : (
                            <>
                              <option value="🌅 Morning (09:30 AM)">🌅 Morning (09:30 AM)</option>
                              <option value="☀️ Afternoon (02:30 PM)">☀️ Afternoon (02:30 PM)</option>
                              <option value="🌇 Evening (05:30 PM)">🌇 Evening (05:30 PM)</option>
                            </>
                          )}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Guests</label>
                        <input
                          type="number"
                          min="1"
                          max={exp.maxGroupSize || 20}
                          value={bookingGuests}
                          onChange={(e) => setBookingGuests(Math.max(1, Number(e.target.value)))}
                          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-muted-foreground">
                        Est. total:{" "}
                        <strong className="text-foreground">
                          ₹{((exp.pricePerPerson || 0) * bookingGuests).toLocaleString("en-IN")}
                        </strong>
                      </span>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={sendingInquiry}
                        onClick={handleBookingSubmit}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                      >
                        <Send size={12} />
                        <span>{sendingInquiry ? "Sending..." : "Confirm & Open WhatsApp"}</span>
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Inline Report Modal */}
              <AnimatePresence>
                {showReportModal && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="mt-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex flex-col gap-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                        <Flag size={13} /> Report this Listing to Trust & Safety
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowReportModal(false)}
                        className="text-muted-foreground hover:text-foreground text-xs"
                      >
                        ✕
                      </button>
                    </div>
                    <select
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-rose-500"
                    >
                      <option value="Inaccurate or outdated details">Inaccurate or outdated details</option>
                      <option value="Fake or unresponsive host contact">Fake or unresponsive host contact</option>
                      <option value="Scam, phishing, or off-platform payment demand">
                        Scam, phishing, or off-platform payment demand
                      </option>
                      <option value="Unsafe, illegal, or prohibited activity">
                        Unsafe, illegal, or prohibited activity
                      </option>
                    </select>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => setShowReportModal(false)}
                        disabled={submittingReport}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={handleReportSubmit}
                        disabled={submittingReport}
                        className="bg-rose-600 hover:bg-rose-700 text-white"
                      >
                        {submittingReport ? "Reporting..." : "Submit Report"}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          )}

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
                {exp.community.quotes.map((q, i) => (
                  <div key={i} className="clay-raised-sm p-3 text-xs leading-relaxed">
                    <p className="italic">“{q.text}”</p>
                    <p className="mt-1 text-[11px] font-bold text-muted-foreground">— {q.author}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* facts grid */}
          <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {facts.map((f, i) => (
              <div key={i} className="clay-raised-sm p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span className="text-primary">{f.icon}</span> {f.label}
                </div>
                <div className="mt-1 text-xs font-semibold">{f.value}</div>
              </div>
            ))}
          </section>

          {/* sources toggle */}
          <section className="text-xs">
            <button
              onClick={() => setShowSources(!showSources)}
              className="flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground"
            >
              <BookOpen size={13} /> {t("detail.sources")} ({exp.sources.length})
              <ChevronDown size={13} className={cn("transition-transform", showSources && "rotate-180")} />
            </button>
            {showSources && (
              <div className="clay-pressed mt-2 space-y-1 p-3">
                {exp.sources.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <span>
                      <strong className="text-foreground">{s.source}</strong> · {s.attribution}
                    </span>
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-primary hover:underline"
                      >
                        <ExternalLink size={10} /> source
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
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
