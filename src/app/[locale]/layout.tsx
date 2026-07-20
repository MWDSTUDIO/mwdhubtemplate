import type { Metadata, Viewport } from "next";
import { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Cormorant_Garamond, Jost } from "next/font/google";
import { routing } from "@/i18n/routing";
import { PwaRegister } from "@/components/PwaRegister";
import "../globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap"
});

const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-jost",
  display: "swap"
});

export const metadata: Metadata = {
  title: "The Inner House — Madame Wedding Design",
  description:
    "The client portal of Madame Wedding Design, a Parisian house of wedding planning and production.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "The Inner House"
  },
  icons: { apple: "/brand/icon-192.png" }
};

export const viewport: Viewport = {
  themeColor: "#22382B",
  width: "device-width",
  initialScale: 1
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale}>
      <body className={`${cormorant.variable} ${jost.variable}`}>
        <NextIntlClientProvider>
          {children}
          <PwaRegister />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
