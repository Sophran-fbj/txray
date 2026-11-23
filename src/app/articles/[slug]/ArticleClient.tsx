'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { pickText, type Article } from '@/content/articles';
import { useI18n } from '@/lib/i18n/provider';

export function ArticleClient({ article }: { article: Article }) {
  const { locale, t } = useI18n();

  return (
    <AppShell maxWidth="3xl">
      <article>
        <div>
          <Link
            href="/articles"
            className="text-sm text-base-content/65 hover:text-base-content"
          >
            ← {t.common.articles}
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {article.tags.map((tag) => (
            <span className="badge badge-outline badge-sm" key={tag}>
              {tag}
            </span>
          ))}
        </div>

        <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-primary sm:text-4xl">
          {pickText(article.title, locale)}
        </h1>
        <p className="mt-3 text-base leading-7 text-base-content/75">
          {pickText(article.description, locale)}
        </p>
        <p className="mt-2 text-xs text-base-content/55">{article.date}</p>

        <div className="mt-8 border-t border-base-300/70 pt-8">
          {article.sections.map((section) => (
            <section className="mb-8" key={section.heading.zh}>
              <h2 className="mb-3 text-xl font-semibold sm:text-2xl">
                {pickText(section.heading, locale)}
              </h2>
              {section.body.map((paragraph) => (
                <p
                  className="mb-3 leading-7 text-base-content/85"
                  key={paragraph.zh}
                >
                  {pickText(paragraph, locale)}
                </p>
              ))}
            </section>
          ))}
        </div>

        <div className="card mt-10 border border-base-300 bg-base-200">
          <div className="card-body p-5">
            <h2 className="card-title text-base">
              {locale === 'zh' ? '动手试试' : 'Try it'}
            </h2>
            <div className="flex flex-wrap gap-2">
              {article.relatedTools.map((tool) => (
                <Link className="btn btn-primary btn-sm" href={tool.href} key={tool.href}>
                  {pickText(tool.label, locale)}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </article>
    </AppShell>
  );
}
