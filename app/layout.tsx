import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Afterwatch — Ton prochain épisode",
  description: "Tes anime, mangas, films et séries. Tes priorités et un programme à ton rythme.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {capable: true, title: "Afterwatch", statusBarStyle: "black-translucent"},
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/icon-192.png" },
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) {
  return <html lang="fr" className="dark"><body>{children}</body></html>;
}
