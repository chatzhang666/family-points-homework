import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "快乐任务屋",
  description: "家庭作业与积分奖励小屋",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "快乐任务屋", statusBarStyle: "default" },
  icons: { apple: "/app-icon.png", icon: "/app-icon.png" }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#65afd1"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
