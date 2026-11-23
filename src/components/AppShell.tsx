'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppearanceControls } from '@/components/AppearanceControls';
import { useI18n } from '@/lib/i18n/provider';

interface AppShellProps {
  children: ReactNode;
  headerRight?: ReactNode;
  maxWidth?: '3xl' | '4xl' | '5xl';
  footerNote?: string;
}

const maxWidthMap = {
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
} as const;

export function AppShell({
  children,
  headerRight,
  maxWidth = '5xl',
  footerNote,
}: AppShellProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const widthClass = maxWidthMap[maxWidth];

  const navItems = [
    { href: '/tools/txray/approvals', label: t.common.nav.approvals },
    { href: '/tools/txray/decoder', label: t.common.nav.decoder },
    { href: '/tools/signature-risk', label: t.common.nav.signatureRisk },
    { href: '/articles', label: t.common.nav.articles },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-base-100 text-base-content">
      <header className="sticky top-0 z-30 border-b border-base-300/80 bg-base-100/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6 md:gap-x-6">
          <Link
            href="/"
            className="order-1 inline-flex shrink-0 items-center gap-2 rounded-lg px-1 py-0.5 text-base font-bold tracking-tight text-base-content transition hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="inline-flex size-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/12 text-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                className="size-4"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 2.75 4 5.5v4.25c0 3.7 2.55 6.95 6 7.75 3.45-.8 6-4.05 6-7.75V5.5l-6-2.75Z"
                />
                <path strokeLinecap="round" d="M6.75 10h6.5M10 6.75v6.5" />
              </svg>
            </span>
            <span>TxRay</span>
          </Link>

          <div className="order-2 ml-auto flex flex-wrap items-center justify-end gap-2 md:order-3">
            {headerRight}
            <AppearanceControls />
          </div>

          <nav
            aria-label={t.common.primaryNav}
            className="order-3 flex w-full flex-wrap items-center gap-1 border-t border-base-300/60 pt-2 md:order-2 md:w-auto md:border-t-0 md:pt-0"
          >
            {navItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition sm:text-sm ${
                    active
                      ? 'bg-primary/12 text-primary'
                      : 'text-base-content/75 hover:bg-base-200 hover:text-base-content'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className={`mx-auto w-full flex-1 px-4 py-6 sm:px-6 sm:py-10 ${widthClass}`}>
        {children}
      </main>

      <footer className="border-t border-base-300/60 bg-base-100">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-base-content/65 sm:px-6">
          <span>{footerNote ?? `🔒 ${t.common.neverSeed}`}</span>
          <Link href="/articles" className="link link-hover text-base-content/70">
            {t.common.nav.articles}
          </Link>
        </div>
      </footer>
    </div>
  );
}
