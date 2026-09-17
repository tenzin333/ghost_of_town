import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "What was here?",
  description: "Drop a pin in central Bengaluru and dig down through what used to be there.",
};

export const viewport: Viewport = { themeColor: "#0d0a07", width: "device-width", initialScale: 1 };

const umamiId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        {children}
        {umamiId && <Script src="https://cloud.umami.is/script.js" data-website-id={umamiId} strategy="afterInteractive" />}
      </body>
    </html>
  );
}
