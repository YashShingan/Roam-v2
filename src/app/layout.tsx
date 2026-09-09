import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Roam — community-signal travel, from open data",
    template: "%s · Roam",
  },
  description:
    "Discover real local experiences in India — cafes, bazaars, forts and heritage walks — from 13 keyless open-data sources. Voice trip planner included. No accounts, no API keys, no fabricated ratings.",
  applicationName: "Roam",
  keywords: ["travel", "india", "open data", "openstreetmap", "trip planner", "voice"],
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F2EB" },
    { media: "(prefers-color-scheme: dark)", color: "#211D1A" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={dmSans.variable}>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
