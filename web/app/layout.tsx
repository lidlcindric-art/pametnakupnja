import "./globals.css";
import type { Metadata, Viewport } from "next";
import SWRegister from "@/components/SWRegister";

export const metadata: Metadata = {
  title: "PametnaKupnja — najjeftinija košarica u Hrvatskoj",
  description:
    "Složi košaricu iz kataloga namirnica ili iz recepta s Coolinarike i saznaj u kojoj je trgovini cijela kupnja najjeftinija.",
  manifest: "/manifest.webmanifest",
  applicationName: "PametnaKupnja",
  appleWebApp: { capable: true, title: "PametnaKupnja", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192" }, { url: "/icons/icon-512.png", sizes: "512x512" }],
    apple: "/icons/apple-touch-icon.png",
  },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f7a4a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hr">
      <body>
        {children}
        <SWRegister />
      </body>
    </html>
  );
}
