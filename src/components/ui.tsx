"use client";

// ─── UI primitives: clay buttons, chips, dialogs, sheets, sliders, skeletons ─
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Component, useEffect, useRef, useState, type ReactNode , useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

export const SPRING = { type: "spring", stiffness: 260, damping: 26 } as const;

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  children,
  variant = "default",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "accent";
  size?: "sm" | "md" | "lg" | "icon";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 font-medium transition-transform active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none select-none";
  const variants = {
    default: "clay-raised-sm hover:clay-lift text-foreground",
    primary: "clay-primary rounded-2xl hover:brightness-105",
    ghost: "hover:bg-surface rounded-2xl text-foreground",
    accent: "bg-accent text-white rounded-2xl shadow-md hover:brightness-105",
  } as const;
  const sizes = {
    sm: "text-xs px-3 h-8 rounded-xl",
    md: "text-sm px-4 h-10 rounded-2xl",
    lg: "text-base px-6 h-12 rounded-[20px]",
    icon: "h-10 w-10 rounded-2xl",
  } as const;
  return (
    <button
      className={cn(base, variant === "primary" ? variants.primary : variants[variant], sizes[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Chip({
  active,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3.5 h-9 text-[13px] font-medium whitespace-nowrap transition-all active:scale-[0.97]",
        active
          ? "clay-primary clay-primary-pressed"
          : "clay-raised-sm hover:clay-lift text-foreground/90",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-surface border border-border",
      )}
    >
      <motion.span
        layout
        transition={SPRING}
        className={cn(
          "absolute top-1 h-5 w-5 rounded-full bg-white shadow",
          checked ? "left-6" : "left-1",
        )}
      />
    </button>
  );
}

export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  label,
  format,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => string;
}) {
  return (
    <label className="flex flex-col gap-1.5 min-w-40">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
        {label}: <span className="text-foreground normal-case">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full appearance-none rounded-full bg-surface accent-[var(--primary)] cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
          [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
      />
    </label>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer", className)} aria-hidden />;
}

/** Modal dialog rendered in a portal with focus trap + Esc close. */
export function Modal({
  open,
  onClose,
  children,
  labelledBy,
  wide,
  side,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  wide?: boolean;
  side?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = (): HTMLElement[] => {
      if (!node) return [];
      return [...node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
    };
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const f = focusables();
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);

  // SSR hydration guard without setState-in-effect (React-documented pattern)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-[3px]"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            initial={side ? { x: "100%" } : { y: 60, opacity: 0, scale: 0.97 }}
            animate={side ? { x: 0 } : { y: 0, opacity: 1, scale: 1 }}
            exit={side ? { x: "100%" } : { y: 40, opacity: 0, scale: 0.98 }}
            transition={SPRING}
            className={cn(
              "relative clay-raised-lg bg-card overflow-hidden flex flex-col",
              side
                ? "h-full w-full max-w-md ml-auto rounded-none sm:rounded-l-[26px]"
                : cn(
                    "w-full max-h-[95dvh] sm:max-h-[88dvh] rounded-t-[26px] sm:rounded-[26px]",
                    wide ? "max-w-3xl" : "max-w-lg",
                  ),
            )}
          >
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 z-10 h-10 w-10 clay-raised-sm rounded-full flex items-center justify-center hover:clay-pressed active:scale-95 transition-transform"
            >
              <X size={18} />
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// SSR-safe portals use the mounted flag above.

/** Section-level error boundary — a failing section never white-screens the app. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="clay-raised m-4 p-6 text-center" role="alert">
          <p className="font-semibold text-foreground">“{this.props.label}” hit a snag</p>
          <p className="text-sm text-muted-foreground mt-1">
            This section degraded gracefully — everything else keeps working.
          </p>
          <Button className="mt-3" onClick={() => this.setState({ error: null })}>
            Retry section
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Tiny inline SVG sparkline (sentiment over quotes). */
export function Sparkline({ points, width = 72, height = 22 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * width},${height - 2 - ((p - min) / range) * (height - 4)}`)
    .join(" L");
  const positive = points[points.length - 1] >= 0;
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <path d={`M${d}`} fill="none" stroke={positive ? "var(--accent)" : "#c2603f"} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 24-cell best-time heat strip. */
export function HeatStrip({ bestTime, golden }: { bestTime?: string; golden?: boolean }) {
  const win = /morning|8/i.test(bestTime ?? "")
    ? [7, 12]
    : /noon|afternoon|13/i.test(bestTime ?? "")
      ? [12, 17]
      : /evening|5–9|17|sunset|golden/i.test(bestTime ?? "")
        ? [16, 21]
        : /night|8 PM|20/i.test(bestTime ?? "")
          ? [19, 24]
          : [8, 22];
  return (
    <div className="flex gap-[2px] items-end h-4" aria-label={`Best time: ${bestTime ?? "flexible"}`}>
      {Array.from({ length: 24 }, (_, h) => {
        const inWindow = h >= win[0] && h < win[1];
        return (
          <div
            key={h}
            className={cn(
              "w-1.5 rounded-[2px] transition-all",
              inWindow ? (golden ? "bg-gold" : "bg-primary") : "bg-surface",
            )}
            style={{ height: inWindow ? 16 : 6 }}
          />
        );
      })}
    </div>
  );
}
