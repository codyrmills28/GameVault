import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RealmSwap | One Subscription, Many Game Worlds",
  description: "Ditch paying for multiple game servers. With RealmSwap, swap between Minecraft, Valheim, Project Zomboid, and ARK instantly with one subscription.",
  keywords: ["game server hosting", "minecraft hosting", "valheim server", "project zomboid server", "game server backups"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-background text-white antialiased cyber-grid-bg">
        {children}
      </body>
    </html>
  );
}
