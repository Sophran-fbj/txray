'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';

interface CopyButtonProps {
  value: string | (() => string);
  label?: string;
  text?: string;
  copiedText?: string;
  className?: string;
}

export function CopyButton({
  value,
  label,
  text,
  copiedText,
  className = '',
}: CopyButtonProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function resetLater() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus('idle'), 1500);
  }

  async function handleCopy() {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('Clipboard API unavailable');
      }
      const payload = typeof value === 'function' ? value() : value;
      await navigator.clipboard.writeText(payload);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
    resetLater();
  }

  const accessibleLabel =
    status === 'copied'
      ? (copiedText ?? t.common.copied)
      : status === 'failed'
        ? t.common.copyFailed
        : label
          ? `${t.common.copy} ${label}`
          : (text ?? t.common.copy);

  const statusTitle =
    status === 'copied'
      ? (copiedText ?? t.common.copied)
      : status === 'failed'
        ? t.common.copyFailed
        : (text ?? t.common.copy);

  const toneClass =
    status === 'copied'
      ? 'text-success hover:text-success'
      : status === 'failed'
        ? 'text-error hover:text-error'
        : '';

  const labelText =
    status === 'copied'
      ? (copiedText ?? text)
      : status === 'failed'
        ? t.common.copyFailed
        : text;

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={accessibleLabel}
      title={statusTitle}
      className={`btn btn-ghost btn-xs inline-flex h-6 min-h-0 shrink-0 items-center gap-1 px-1.5 text-base-content/60 hover:text-base-content ${toneClass} ${className}`}
    >
      {status === 'copied' ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="size-3.5"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
            clipRule="evenodd"
          />
        </svg>
      ) : status === 'failed' ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="size-3.5"
          aria-hidden="true"
        >
          <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="size-3.5"
          aria-hidden="true"
        >
          <path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h2.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 1 .439 1.061V9.5A1.5 1.5 0 0 1 12 11V8.621a3 3 0 0 0-.879-2.121L9 4.379A3 3 0 0 0 6.879 3.5H5.5Z" />
          <path d="M4 5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 14h5a1.5 1.5 0 0 0 1.5-1.5V8.621a1.5 1.5 0 0 0-.44-1.06L7.94 5.439A1.5 1.5 0 0 0 6.878 5H4Z" />
        </svg>
      )}
      {text && <span className="text-[11px] font-medium">{labelText}</span>}
    </button>
  );
}
