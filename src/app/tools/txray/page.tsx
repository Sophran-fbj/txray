'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { WalletButton } from '@/components/WalletButton';
import { useI18n } from '@/lib/i18n/provider';

export default function TxRayPage() {
  const { t } = useI18n();

  return (
    <AppShell maxWidth="4xl" headerRight={<WalletButton />}>
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary sm:text-4xl">TxRay</h1>
        <p className="mt-2 text-sm text-base-content/80 sm:text-base">{t.txray.intro}</p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/tools/txray/approvals"
          className="card border border-base-300 bg-base-200 transition hover:border-primary/40 hover:bg-base-300/40"
        >
          <div className="card-body p-5">
            <h2 className="card-title text-lg">{t.txray.approvalsTitle}</h2>
            <p className="text-sm leading-6 text-base-content/70">{t.txray.approvalsDesc}</p>
          </div>
        </Link>

        <Link
          href="/tools/txray/decoder"
          className="card border border-base-300 bg-base-200 transition hover:border-primary/40 hover:bg-base-300/40"
        >
          <div className="card-body p-5">
            <h2 className="card-title text-lg">{t.txray.decoderTitle}</h2>
            <p className="text-sm leading-6 text-base-content/70">{t.txray.decoderDesc}</p>
          </div>
        </Link>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="card border border-base-300 bg-base-200">
          <div className="card-body p-5">
            <h2 className="card-title text-base">{t.txray.demoTitle}</h2>
            <p className="text-sm text-base-content/70">{t.txray.demoDesc}</p>
            <div className="card-actions mt-2">
              <Link href="/tools/txray/approvals?demo=1" className="btn btn-primary btn-sm">
                {t.txray.openApprovalDemo}
              </Link>
            </div>
          </div>
        </div>

        <div className="card border border-base-300 bg-base-200">
          <div className="card-body p-5">
            <h2 className="card-title text-base">{t.txray.articleTitle}</h2>
            <p className="text-sm text-base-content/70">{t.txray.articleDesc}</p>
            <div className="card-actions mt-2">
              <Link
                href="/articles/why-unlimited-approval-is-dangerous"
                className="btn btn-outline btn-sm border-base-300"
              >
                {t.txray.unlimitedApproval}
              </Link>
              <Link
                href="/articles/why-batched-transactions-hide-risk"
                className="btn btn-outline btn-sm border-base-300"
              >
                {t.txray.batchedTransactions}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
