import "./globals.css";
import { Providers } from "@/components/Providers";
import { Navbar } from "@/components/Navbar";

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className="bg-gray-50 min-h-screen" suppressHydrationWarning>
                <Providers>
                    <Navbar />
                    <main className="max-w-5xl mx-auto px-4 py-8">
                        {children}
                    </main>
                </Providers>
            </body>
        </html>
    );
}