import type { Metadata } from "next";
import "./globals.css";
import { WebSocketProvider } from '@/context/WebSocketContext'
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from "@/context/CartContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { ToastProvider } from "@/components/Toast/ToastContext";
import { NotificationProvider } from "@/context/NotificationContext";
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
        <LanguageProvider>
          <AuthProvider>
            <WebSocketProvider>
              <NotificationProvider>
                <CartProvider>
                  <ToastProvider>
                      {children}
                  </ToastProvider> 
                  <FloatingChat />
                  <AIFloatingChat />
                <Footer />
                </CartProvider>
              </NotificationProvider>
            </WebSocketProvider>
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
