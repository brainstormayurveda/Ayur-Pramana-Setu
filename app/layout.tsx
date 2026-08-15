import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AyurPramanaSetu",
  description: "Evidence-quality audit of Ayurveda clinical trials registered on CTRI",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              AyurPramana<span className="text-emerald-700">Setu</span>
            </Link>
            <nav className="flex gap-6 text-sm font-medium text-stone-600">
              <Link href="/" className="hover:text-stone-900">
                Trials
              </Link>
              <Link href="/conditions" className="hover:text-stone-900">
                Fragmentation Report
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-stone-200 bg-white py-4 text-center text-xs text-stone-500">
          Research-integrity audit of Ayurveda trials on CTRI, via WHO ICTRP. Not medical advice.
        </footer>
      </body>
    </html>
  );
}
