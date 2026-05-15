import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { WebSocketProvider } from '@/context/WebSocketContext'
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from "@/context/CartContext";
import { ToastProvider } from "@/components/Toast/ToastContext";
import Footer from "@/components/Footer/Footer";
import FloatingChat from "@/components/FloatingChat/FloatingChat";

const inter = Inter({ subsets: ["latin"] });

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
      <body className={inter.className}>
        <AuthProvider>
          <WebSocketProvider>
            <CartProvider>
              <ToastProvider>
                  {children}
              </ToastProvider> {/*suggested moving toast as parents of floating chat and footer */}
              <FloatingChat />
            <Footer />
			</CartProvider>
          </WebSocketProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
