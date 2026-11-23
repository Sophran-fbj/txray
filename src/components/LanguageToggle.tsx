'use client';

import { useI18n } from '@/lib/i18n/provider';

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="join h-8 items-center rounded-lg border border-base-300 bg-base-200 p-0.5">
      <button
        className={`btn join-item btn-xs h-6.5 min-h-0 rounded-md border-0 px-2.5 ${locale === 'zh' ? 'btn-primary' : 'btn-ghost text-base-content/75'}`}
        onClick={() => setLocale('zh')}
        type="button"
        aria-label={t.common.zh}
      >
        中
      </button>
      <button
        className={`btn join-item btn-xs h-6.5 min-h-0 rounded-md border-0 px-2.5 ${locale === 'en' ? 'btn-primary' : 'btn-ghost text-base-content/75'}`}
        onClick={() => setLocale('en')}
        type="button"
        aria-label={t.common.en}
      >
        EN
      </button>
    </div>
  );
}
