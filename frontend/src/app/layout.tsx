import type { Metadata } from "next";
import "./globals.css";
import { WebSocketProvider } from '@/context/WebSocketContext'
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from "@/components/Toast/ToastContext";
import Footer from "@/components/Footer/Footer";
import FloatingChat from "@/components/FloatingChat/FloatingChat";
import AIFloatingChat from "@/components/AIFloatingChat/AIFloatingChat";

export const metadata: Metadata = {
  title: "Transcendence Marketplace",
  description: "A real-time marketplace platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <WebSocketProvider>
            <ToastProvider>{children}</ToastProvider>
              <FloatingChat />
              <AIFloatingChat />
            <Footer />
          </WebSocketProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
