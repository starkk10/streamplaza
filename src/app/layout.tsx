import type { Metadata, Viewport } from "next";
import { Sora, Nunito_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { getSettings } from "@/server/settings";

const display = Sora({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display" });
const body = Nunito_Sans({ subsets: ["latin"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500"], variable: "--font-mono" });

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings().catch(() => null);
  const name = s?.["store.name"] ?? "StreamPlaza";
  return { title: { default: name, template: `%s · ${name}` }, description: "Tienda de suscripciones y servicios digitales." };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
