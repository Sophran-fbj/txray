'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { articles, pickText } from '@/content/articles';
import { useI18n } from '@/lib/i18n/provider';

export default function ArticlesPage() {
  const { locale, t } = useI18n();

  return (
    <AppShell maxWidth="3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">{t.common.articles}</h1>
        <p className="mt-2 text-sm text-base-content/70">
          {locale === 'zh'
            ? 'TxRay 的文章是工具的解释层：把每个风险点讲清楚。'
            : 'TxRay articles are the explanation layer behind the tools.'}
        </p>
      </div>

      <div className="mt-8 grid gap-4">
        {articles.map((article) => (
          <Link
            key={article.slug}
            href={`/articles/${article.slug}`}
            className="card border border-base-300 bg-base-200 transition hover:border-primary/40 hover:bg-base-300/40"
          >
            <div className="card-body p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="card-title text-lg">{pickText(article.title, locale)}</h2>
                {article.tags.map((tag) => (
                  <span className="badge badge-outline badge-sm" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <p className="text-sm leading-6 text-base-content/70">
                {pickText(article.description, locale)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
