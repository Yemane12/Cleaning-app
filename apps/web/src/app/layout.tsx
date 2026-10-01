import type { Metadata } from 'next';
import { Noto_Sans, Noto_Sans_Ethiopic } from 'next/font/google';
import { Header } from '@/components/Header';
import { Providers } from '@/components/Providers';
import './globals.css';

// Latin text, and Ge'ez script for Amharic names and, later, the Amharic UI.
const notoSans = Noto_Sans({ variable: '--font-latin', subsets: ['latin'] });
const notoEthiopic = Noto_Sans_Ethiopic({ variable: '--font-ethiopic', subsets: ['ethiopic'] });

export const metadata: Metadata = {
  title: 'Cleaning',
  description: 'Book trusted home cleaners in Addis Ababa and pay with telebirr, CBE Birr or card.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${notoSans.variable} ${notoEthiopic.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-stone-50 text-stone-900">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
