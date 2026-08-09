import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Rajdhani } from "next/font/google";
import { PeriodProvider } from "@/components/shell/PeriodProvider";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import "./globals.css";

// next/font variables use distinct names from Tailwind `@theme --font-*`
// keys so theme tokens can reference them without circular `var(--font-x)`.
const display = Rajdhani({
  variable: "--font-rajdhani",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const body = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "SmartSmelt ERP",
  description:
    "Akuntansi karbon untuk smelter nikel RKEF — emisi, kepatuhan, proyeksi harga, dan advisori.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      data-theme="dark"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <PeriodProvider>{children}</PeriodProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
