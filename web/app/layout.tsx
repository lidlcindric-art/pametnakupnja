import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "PametnaKupnja — najjeftinija košarica u Hrvatskoj",
  description:
    "Složi košaricu iz kataloga namirnica ili iz recepta s Coolinarike i saznaj u kojoj je trgovini cijela kupnja najjeftinija.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f7a4a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hr">
      <body>{children}</body>
    </html>
  );
}
