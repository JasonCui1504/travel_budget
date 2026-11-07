import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Installs as a home-screen app ("Travels") with its own manifest and icons.
export const metadata: Metadata = {
  metadataBase: new URL("https://travel.jascui.com"),
  title: "Llama + Shrimp Travels",
  description: "Trips, itineraries and the travel budget.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Travels", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#0d1110",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-canvas text-prose antialiased font-sans">
        <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 sm:pt-10">{children}</main>
        <Analytics />
      </body>
    </html>
  );
}
