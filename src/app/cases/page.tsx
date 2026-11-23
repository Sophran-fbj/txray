'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { pickText } from '@/content/articles';
import {
  riskCases,
  riskCaseHref,
  type RiskCaseCategory,
} from '@/content/riskCases';
import { useI18n } from '@/lib/i18n/provider';

type CategoryFilter = 'all' | RiskCaseCategory;

const CATEGORIES: CategoryFilter[] = ['all', 'approval', 'batch', 'signature'];

export default function CasesPage() {
  const { locale, t } = useI18n();
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all');

  const copy = t.cases;
  const visibleCases =
    selectedCategory === 'all'
      ? riskCases
      : riskCases.filter((item) => item.category === selectedCategory);

  return (
    <AppShell maxWidth="5xl">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <span>{copy.badge}</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">{copy.title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-base-content/75">{copy.subtitle}</p>
      </div>

      <div
        role="group"
        aria-label={copy.title}
        className="mt-6 flex flex-wrap items-center gap-2"
      >
        {CATEGORIES.map((category) => {
          const active = selectedCategory === category;
          return (
            <button
              key={category}
              type="button"
              aria-pressed={active}
              onClick={() => setSelectedCategory(category)}
              className={`btn btn-sm ${
                active ? 'btn-primary' : 'btn-outline border-base-300'
              }`}
            >
              {copy.categories[category]}
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {visibleCases.map((item) => {
          const actionLabel =
            item.tool === 'decoder' ? copy.openInDecoder : copy.openInSignatureRisk;

          return (
            <article
              key={item.id}
              data-case-id={item.id}
              className="card border border-base-300 bg-base-200 transition hover:border-primary/40"
            >
              <div className="card-body justify-between gap-4 p-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="badge badge-error badge-sm">{copy.highRisk}</span>
                    <span className="badge badge-outline badge-sm">
                      {copy.categories[item.category]}
                    </span>
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="badge badge-ghost badge-xs text-base-content/70"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div>
                    <h2 className="text-lg font-semibold text-base-content">
                      {pickText(item.title, locale)}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-base-content/75">
                      {pickText(item.summary, locale)}
                    </p>
                  </div>

                  <div className="space-y-2 rounded-box border border-base-300/80 bg-base-100/60 p-3 text-xs leading-5">
                    <div>
                      <span className="font-semibold text-warning">{copy.lureLabel}: </span>
                      <span className="text-base-content/80">{pickText(item.lure, locale)}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-primary">
                        {copy.txrayFindsLabel}:{' '}
                      </span>
                      <span className="text-base-content/80">
                        {pickText(item.whatTxRayFinds, locale)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-300/70 pt-3">
                  <Link href={riskCaseHref(item)} className="btn btn-primary btn-sm">
                    {actionLabel} →
                  </Link>
                  <Link
                    href={`/articles/${item.articleSlug}`}
                    className="link link-hover text-xs text-base-content/75"
                  >
                    {copy.readArticle}
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}
