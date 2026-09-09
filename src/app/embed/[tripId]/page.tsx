import Link from "next/link";
import type { Metadata } from "next";
import { getTrip } from "@/lib/db";

interface Props {
  params: Promise<{ tripId: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tripId } = await params;
  const trip = getTrip(tripId);
  return {
    title: trip ? `Trip: ${trip.cityLabel.split(",")[0]}` : "Trip not found",
    robots: { index: false },
  };
}

export default async function EmbedPage({ params }: Props) {
  const { tripId } = await params;
  const trip = getTrip(tripId);

  if (!trip) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-8">
        <div className="clay-raised p-8 text-center">
          <p className="text-2xl">🧭</p>
          <p className="mt-2 font-bold">Trip not found</p>
          <Link href="/" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
            Plan a new one →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Roam embed · {trip.cityLabel.split(",")[0]}</p>
      <h1 className="mt-1 text-xl font-bold">{trip.days.length}-day plan</h1>
      <p className="text-[12px] text-muted-foreground">{trip.feasibility.message}</p>
      {trip.days.map((d, i) => (
        <section key={i} className="clay-raised mt-3 p-4">
          <h2 className="text-[13px] font-bold">
            Day {i + 1} · {d.totalHours} h · ~{d.walkKm ?? "?"} km
          </h2>
          <ol className="mt-2 space-y-1.5">
            {d.stops.map((s, si) => (
              <li key={si} className="text-[13px]">
                <span className="font-bold text-primary">
                  {s.slotStart}–{s.slotEnd}
                </span>{" "}
                {s.name}
                {s.pricePerPerson !== undefined && <span className="text-muted-foreground"> · ₹{s.pricePerPerson}</span>}
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="mt-3 text-center text-[12px] text-muted-foreground">
        Estimated ₹{Intl.NumberFormat("en-IN").format(trip.budgetTotal ?? 0)} per person ·{" "}
        <Link href={`/?trip=${trip.id}`} className="font-semibold text-primary hover:underline">
          open in Roam
        </Link>
      </p>
    </main>
  );
}
