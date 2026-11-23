'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { articles, pickText } from '@/content/articles';
import { getRiskCase, riskCaseHref } from '@/content/riskCases';
import { useI18n } from '@/lib/i18n/provider';

const FEATURED_CASE_IDS = [
  'safe-multisend-delegatecall',
  'universal-router-permit2-sweep',
  'seaport-zero-return-nft',
] as const;

export default function Home() {
  const { locale, t } = useI18n();

  const tools = [
    {
      href: '/tools/txray/approvals',
      title: t.txray.approvalsTitle,
      description: t.txray.approvalsDesc,
      badge: t.common.available,
      badgeClass: 'badge-primary',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="size-5 text-primary"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 2.75 4.25 5.25v4.5c0 3.6 2.45 6.8 5.75 7.5 3.3-.7 5.75-3.9 5.75-7.5v-4.5L10 2.75Z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="m7.5 10.25 1.75 1.75 3.5-3.75" />
        </svg>
      ),
    },
    {
      href: '/tools/txray/decoder',
      title: t.txray.decoderTitle,
      description: t.txray.decoderDesc,
      badge: t.common.available,
      badgeClass: 'badge-primary',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="size-5 text-primary"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 6 3 10l3.5 4M13.5 6 17 10l-3.5 4M11 4.5l-2 11" />
        </svg>
      ),
    },
    {
      href: '/tools/signature-risk',
      title: t.home.signatureRiskTitle,
      description: t.home.signatureRiskDesc,
      badge: t.common.available,
      badgeClass: 'badge-secondary',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="size-5 text-secondary"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 14.5h11M6.25 11.75l7.5-7.5 2 2-7.5 7.5-2.75.75.75-2.75Z"
          />
        </svg>
      ),
    },
  ];

  return (
    <AppShell maxWidth="5xl">
      <section className="rounded-box border border-base-300 bg-base-200 p-6 sm:p-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <span aria-hidden="true">🔒</span>
          <span>{t.home.badge}</span>
        </div>

        <h1 className="mt-4 text-3xl font-bold tracking-tight text-base-content sm:text-4xl">
          {t.home.title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-base-content/80 sm:text-base">
          {t.home.subtitle}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/tools/txray/approvals" className="btn btn-primary btn-sm sm:btn-md">
            {t.home.primaryCta}
          </Link>
          <Link
            href="/tools/txray/approvals?demo=1"
            className="btn btn-outline btn-sm sm:btn-md border-base-300 hover:border-primary/40"
          >
            {t.home.demoCta}
          </Link>
        </div>
      </section>

      <section className="mt-8" aria-labelledby="home-tools-heading">
        <h2
          id="home-tools-heading"
          className="text-xs font-semibold uppercase tracking-wider text-base-content/60"
        >
          {t.home.toolsHeading}
        </h2>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group card border border-base-300 bg-base-200 transition hover:border-primary/40 hover:bg-base-200/80"
            >
              <div className="card-body justify-between gap-4 p-5">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex size-9 items-center justify-center rounded-lg border border-base-300 bg-base-100">
                      {tool.icon}
                    </span>
                    <span className={`badge badge-sm ${tool.badgeClass}`}>{tool.badge}</span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-base-content group-hover:text-primary">
                    {tool.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-6 text-base-content/70">
                    {tool.description}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                  <span>{t.home.openTool}</span>
                  <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="home-cases-heading">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="home-cases-heading"
            className="text-xs font-semibold uppercase tracking-wider text-base-content/60"
          >
            {t.home.casesHeading}
          </h2>
          <Link href="/cases" className="link link-hover text-xs text-primary">
            {t.home.viewAllCases} →
          </Link>
        </div>

        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {FEATURED_CASE_IDS.map((id) => getRiskCase(id))
            .filter((item): item is NonNullable<typeof item> => Boolean(item))
            .map((item) => (
              <Link
                key={item.id}
                href={riskCaseHref(item)}
                className="group card border border-base-300 bg-base-200 transition hover:border-primary/40 hover:bg-base-300/35"
              >
                <div className="card-body justify-between gap-3 p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="badge badge-error badge-xs">{t.cases.highRisk}</span>
                      <span className="badge badge-outline badge-xs">
                        {t.cases.categories[item.category]}
                      </span>
                    </div>
                    <h3 className="mt-2.5 text-sm font-semibold text-base-content group-hover:text-primary">
                      {pickText(item.title, locale)}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-base-content/70">
                      {pickText(item.summary, locale)}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <span>{t.home.inspectCase}</span>
                    <span
                      aria-hidden="true"
                      className="transition-transform group-hover:translate-x-0.5"
                    >
                      →
                    </span>
                  </span>
                </div>
              </Link>
            ))}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="home-articles-heading">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="home-articles-heading"
            className="text-xs font-semibold uppercase tracking-wider text-base-content/60"
          >
            {t.home.articlesHeading}
          </h2>
          <Link href="/articles" className="link link-hover text-xs text-primary">
            {t.home.viewAllArticles} →
          </Link>
        </div>

        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {articles.map((article) => (
            <Link
              key={article.slug}
              href={`/articles/${article.slug}`}
              className="card border border-base-300 bg-base-200 transition hover:border-primary/40 hover:bg-base-300/35"
            >
              <div className="card-body gap-2 p-5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {article.tags.map((tag) => (
                    <span key={tag} className="badge badge-outline badge-xs text-base-content/70">
                      {tag}
                    </span>
                  ))}
                </div>
                <h3 className="text-base font-semibold text-base-content">
                  {pickText(article.title, locale)}
                </h3>
                <p className="text-sm text-base-content/70">
                  {pickText(article.description, locale)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
