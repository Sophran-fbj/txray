'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { CopyButton } from '@/components/CopyButton';
import { pickText } from '@/content/articles';
import { getRiskCase } from '@/content/riskCases';
import { useI18n } from '@/lib/i18n/provider';
import {
  analyzeTypedData,
  type FieldFinding,
  type OrderAssetItem,
  type OrderSummary,
  type SignatureAnalysis,
  type SignatureDanger,
  type SignatureRiskKind,
} from '@/features/signature-risk/analyzer';

const EXAMPLE_PERMIT = JSON.stringify(
  {
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: 1,
      verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    primaryType: 'Permit',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    message: {
      owner: '0xFb3C2B2769A2119f349233A44A640F090C907667',
      spender: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      value:
        '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      nonce: '8',
      deadline: '4102444800',
    },
  },
  null,
  2,
);

const EXAMPLE_PERMIT2 = JSON.stringify(
  {
    domain: {
      name: 'Permit2',
      chainId: 1,
      verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    },
    primaryType: 'PermitSingle',
    types: {
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
    },
    message: {
      details: {
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: '1461501637330902918203684832716283019655932542975',
        expiration: '4102444800',
        nonce: '12',
      },
      spender: '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B',
      sigDeadline: '4102444800',
    },
  },
  null,
  2,
);

const EXAMPLE_SEAPORT_ZERO_RETURN = JSON.stringify(
  {
    domain: {
      name: 'Seaport',
      version: '1.5',
      chainId: 1,
      verifyingContract: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
    },
    primaryType: 'OrderComponents',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      OrderComponents: [
        { name: 'offerer', type: 'address' },
        { name: 'zone', type: 'address' },
        { name: 'offer', type: 'OfferItem[]' },
        { name: 'consideration', type: 'ConsiderationItem[]' },
        { name: 'orderType', type: 'uint8' },
        { name: 'startTime', type: 'uint256' },
        { name: 'endTime', type: 'uint256' },
        { name: 'zoneHash', type: 'bytes32' },
        { name: 'salt', type: 'uint256' },
        { name: 'conduitKey', type: 'bytes32' },
        { name: 'counter', type: 'uint256' },
      ],
      OfferItem: [
        { name: 'itemType', type: 'uint8' },
        { name: 'token', type: 'address' },
        { name: 'identifierOrCriteria', type: 'uint256' },
        { name: 'startAmount', type: 'uint256' },
        { name: 'endAmount', type: 'uint256' },
      ],
      ConsiderationItem: [
        { name: 'itemType', type: 'uint8' },
        { name: 'token', type: 'address' },
        { name: 'identifierOrCriteria', type: 'uint256' },
        { name: 'startAmount', type: 'uint256' },
        { name: 'endAmount', type: 'uint256' },
        { name: 'recipient', type: 'address' },
      ],
    },
    message: {
      offerer: '0xFb3C2B2769A2119f349233A44A640F090C907667',
      zone: '0x0000000000000000000000000000000000000000',
      offer: [
        {
          itemType: 2,
          token: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
          identifierOrCriteria: '4242',
          startAmount: '1',
          endAmount: '1',
        },
      ],
      consideration: [
        {
          itemType: 2,
          token: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
          identifierOrCriteria: '4242',
          startAmount: '1',
          endAmount: '1',
          recipient: '0x2222222222222222222222222222222222222222',
        },
      ],
      orderType: 0,
      startTime: '1700000000',
      endTime: '4102444800',
      zoneHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      salt: '1',
      conduitKey: '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000',
      counter: '0',
    },
  },
  null,
  2,
);

export default function SignaturePage() {
  return (
    <Suspense
      fallback={
        <AppShell maxWidth="5xl">
          <div className="h-32 animate-pulse rounded-box border border-base-300 bg-base-200" />
        </AppShell>
      }
    >
      <SignatureContent />
    </Suspense>
  );
}

function SignatureContent() {
  const { locale, t } = useI18n();
  const searchParams = useSearchParams();
  const initialCaseParam = searchParams.get('case') ?? '';
  const initialMatchedCase = getRiskCase(initialCaseParam);
  const initialSignatureCase =
    initialMatchedCase?.tool === 'signature-risk' ? initialMatchedCase : undefined;

  const copy = t.signatureRisk;
  const [activeCaseId, setActiveCaseId] = useState<string | null>(
    () => initialSignatureCase?.id ?? null,
  );
  const activeCase = activeCaseId ? getRiskCase(activeCaseId) : undefined;
  const activeSignatureCase =
    activeCase?.tool === 'signature-risk' ? activeCase : undefined;

  const [input, setInput] = useState(() => initialSignatureCase?.payload ?? '');
  const [result, setResult] = useState<
    | { status: 'idle' }
    | { status: 'ok'; data: SignatureAnalysis }
    | { status: 'error'; error: string }
  >(() => {
    if (!initialSignatureCase) return { status: 'idle' };
    try {
      return { status: 'ok', data: analyzeTypedData(initialSignatureCase.payload) };
    } catch {
      return { status: 'idle' };
    }
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (activeSignatureCase) {
      params.set('case', activeSignatureCase.id);
    } else {
      params.delete('case');
    }
    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [activeSignatureCase]);

  function runAnalysis(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      setResult({ status: 'idle' });
      return;
    }
    try {
      JSON.parse(trimmed);
    } catch {
      setResult({ status: 'error', error: copy.invalidJson });
      return;
    }
    try {
      setResult({ status: 'ok', data: analyzeTypedData(trimmed) });
    } catch {
      setResult({
        status: 'error',
        error: copy.invalidTypedData,
      });
    }
  }

  function loadSample(value: string) {
    setActiveCaseId(null);
    setInput(value);
    runAnalysis(value);
  }

  return (
    <AppShell maxWidth="5xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">
          {copy.title}
        </h1>
        <p className="mt-1 text-sm text-base-content/70">{copy.desc}</p>
      </div>

      {activeSignatureCase && (
        <div
          data-testid="active-case-banner"
          className="mt-4 rounded-box border border-primary/35 bg-primary/8 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-primary badge-sm">{t.cases.activeCaseBanner}</span>
              <span className="badge badge-error badge-sm">{t.cases.highRisk}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Link
                href={`/articles/${activeSignatureCase.articleSlug}`}
                className="link font-medium text-primary"
              >
                {t.cases.readArticle} →
              </Link>
              <Link href="/cases" className="link link-hover text-base-content/75">
                {t.cases.backToCases}
              </Link>
            </div>
          </div>
          <h2 className="mt-2 text-base font-semibold text-base-content">
            {pickText(activeSignatureCase.title, locale)}
          </h2>
          <p className="mt-1 text-xs leading-5 text-base-content/80">
            <span className="font-semibold text-warning">{t.cases.lureLabel}: </span>
            {pickText(activeSignatureCase.lure, locale)}
          </p>
          <p className="mt-1 text-xs leading-5 text-base-content/80">
            <span className="font-semibold text-primary">{t.cases.txrayFindsLabel}: </span>
            {pickText(activeSignatureCase.whatTxRayFinds, locale)}
          </p>
        </div>
      )}

      <div className="alert alert-warning mt-5 text-sm">
        <span>{copy.readonly}</span>
      </div>

      <details className="collapse-arrow collapse mt-3 border border-base-300 bg-base-200 text-sm">
        <summary className="collapse-title font-medium">{copy.howToGetTitle}</summary>
        <div className="collapse-content space-y-2 text-base-content/75">
          <p>{copy.howToGet}</p>
          <p>{copy.cannotReadPopup}</p>
        </div>
      </details>

      <div className="mt-6 grid gap-6 lg:grid-cols-12 lg:items-start">
        <section className="rounded-box border border-base-300 bg-base-200 p-4 sm:p-5 lg:col-span-5">
          <div className="form-control">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="label py-1" htmlFor="typed-data-input">
                <span className="label-text text-xs font-medium">{copy.inputLabel}</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs border border-base-300 text-primary"
                  onClick={() => loadSample(EXAMPLE_PERMIT)}
                >
                  {copy.permitSample}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs border border-base-300 text-secondary"
                  onClick={() => loadSample(EXAMPLE_PERMIT2)}
                >
                  {copy.permit2Sample}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs border border-base-300 text-error"
                  onClick={() => loadSample(EXAMPLE_SEAPORT_ZERO_RETURN)}
                >
                  {copy.seaportSample}
                </button>
              </div>
            </div>
            <textarea
              id="typed-data-input"
              value={input}
              onChange={(e) => {
                setActiveCaseId(null);
                setInput(e.target.value);
                setResult({ status: 'idle' });
              }}
              placeholder={copy.placeholder}
              className="textarea textarea-bordered mt-1 min-h-64 w-full break-all font-mono text-xs lg:min-h-80"
              spellCheck={false}
              aria-describedby="typed-data-help"
            />
            <p id="typed-data-help" className="mt-2 text-xs text-base-content/70">
              {copy.inputHelp}
            </p>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            {input.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setActiveCaseId(null);
                  setInput('');
                  setResult({ status: 'idle' });
                }}
              >
                {copy.clear}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => runAnalysis(input)}
            >
              {copy.analyze}
            </button>
          </div>
        </section>

        <section className="lg:col-span-7" aria-live="polite">
          {result.status === 'idle' && (
            <div className="card border border-base-300 bg-base-200">
              <div className="card-body gap-3 p-5">
                <h2 className="text-base font-semibold text-base-content">
                  {copy.resultTitle}
                </h2>
                <p className="text-sm text-base-content/70">{copy.idle}</p>
                <ul className="mt-1 space-y-1.5 border-t border-base-300/70 pt-3 text-xs text-base-content/75">
                  {copy.whatWeCheck.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="text-primary" aria-hidden="true">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {result.status === 'error' && (
            <div className="alert alert-error text-sm" role="alert">
              {result.error}
            </div>
          )}
          {result.status === 'ok' && <AnalysisView data={result.data} />}
        </section>
      </div>
    </AppShell>
  );
}

function AnalysisView({ data }: { data: SignatureAnalysis }) {
  const { t } = useI18n();
  const copy = t.signatureRisk;
  const rawMessageJson = JSON.stringify(data.rawMessage, null, 2);

  return (
    <div className="space-y-4">
      {!data.schemaValidated && (
        <div className="alert alert-warning text-sm" role="status">
          {copy.schemaFallback}
        </div>
      )}

      <div className={`alert ${dangerClass(data.danger)}`}>
        <div>
          <div className="font-bold">{riskTitle(t, data.riskKind)}</div>
          <div className="text-sm">
            {data.permit2Mode === 'transfer'
              ? copy.riskExplains.permit2Transfer
              : riskExplain(t, data.riskKind)}
            {(data.riskKind === 'erc20-permit' ||
              data.riskKind === 'permit2' ||
              data.riskKind === 'nft-order') && (
              <Link
                href="/articles/permit2-eip712-phishing"
                className="link ml-2 font-medium"
              >
                {t.common.whyRisky} →
              </Link>
            )}
            {data.signatureExpired && (
              <p className="mt-2">{copy.expiredExplain}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <InfoCard label={copy.domain} value={data.domainName ?? copy.unknown} />
        <InfoCard label={copy.chainId} value={data.chainId ?? copy.notProvided} mono />
        <InfoCard label={copy.primaryType} value={data.primaryType ?? copy.unknown} />
        <InfoCard
          label={copy.verifyingContract}
          value={data.verifyingContract ?? copy.notProvided}
          copyValue={data.verifyingContract}
          mono
        />
      </div>

      {data.orderSummary && <OrderBalanceCard summary={data.orderSummary} />}

      <div className="card border border-base-300 bg-base-200">
        <div className="card-body p-4 sm:p-5">
          <h2 className="card-title text-lg">{copy.fields}</h2>
          {data.findings.length === 0 ? (
            <p className="text-sm text-base-content/65">
              {copy.noFields}
            </p>
          ) : (
            <div className="md:overflow-x-auto">
              <table className="table table-sm block md:table">
                <thead className="hidden md:table-header-group">
                  <tr>
                    <th>{copy.field}</th>
                    <th>{copy.value}</th>
                    <th>{copy.why}</th>
                  </tr>
                </thead>
                <tbody className="block space-y-3 md:table-row-group md:space-y-0">
                  {data.findings.map((finding, index) => (
                    <FindingRow finding={finding} key={`${finding.label}-${index}`} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <details className="collapse-arrow collapse border border-base-300 bg-base-200">
        <summary className="collapse-title text-sm text-base-content/75">
          {copy.rawMessage}
        </summary>
        <div className="collapse-content">
          <div className="mb-2 flex justify-end">
            <CopyButton value={rawMessageJson} label={copy.rawMessage} />
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-base-content/70">
            {rawMessageJson}
          </pre>
        </div>
      </details>
    </div>
  );
}

function FindingRow({ finding }: { finding: FieldFinding }) {
  const { t, locale } = useI18n();
  const copy = t.signatureRisk;
  const value = formatFindingValue(finding, locale, copy);
  const cellClass = 'block px-0 py-1 md:table-cell md:px-3 md:py-2.5';

  return (
    <tr className="block rounded-box border border-base-300 bg-base-100/50 p-3 md:table-row md:border-0 md:bg-transparent md:p-0">
      <td className={cellClass}>
        <div className="mb-1 text-[11px] font-semibold uppercase text-base-content/60 md:hidden">
          {copy.field}
        </div>
        <span className={`badge badge-sm ${badgeClass(finding.severity)}`}>
          {copy.findingLabels[finding.kind]}
        </span>
        {finding.path && (
          <div className="mt-1 font-mono text-xs text-base-content/55">{finding.path}</div>
        )}
      </td>
      <td className={`${cellClass} max-w-sm break-all font-mono text-xs tabular-nums`}>
        <div className="mb-1 font-sans text-[11px] font-semibold uppercase text-base-content/60 md:hidden">
          {copy.value}
        </div>
        {value}
      </td>
      <td className={`${cellClass} text-sm text-base-content/75`}>
        <div className="mb-1 text-[11px] font-semibold uppercase text-base-content/60 md:hidden">
          {copy.why}
        </div>
        {finding.kind === 'amount' && finding.severity === 'high'
          ? `${copy.findingExplains.amount} ${copy.findingExplains.amountUnlimited}`
          : copy.findingExplains[finding.kind]}
      </td>
    </tr>
  );
}

function formatFindingValue(
  finding: FieldFinding,
  locale: 'zh' | 'en',
  copy: ReturnType<typeof useI18n>['t']['signatureRisk'],
): string {
  if (finding.maximumAmountType) return copy.maximumAmount(finding.maximumAmountType);
  if (!finding.deadline) return finding.value;
  const { dateMs, daysRemaining } = finding.deadline;
  if (dateMs === undefined) return copy.deadlineOutsideDateRange(finding.value);
  const date = new Date(dateMs).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');
  return finding.expired ? copy.deadlineExpired(date) : copy.deadlineRemaining(date, daysRemaining ?? 0);
}

function InfoCard({
  label,
  value,
  copyValue,
  mono,
}: {
  label: string;
  value: string;
  copyValue?: string;
  mono?: boolean;
}) {
  return (
    <div className="card border border-base-300 bg-base-200">
      <div className="card-body gap-1 p-3.5">
        <div className="text-xs text-base-content/55">{label}</div>
        <div className="flex items-start justify-between gap-1">
          <div className={mono ? 'break-all font-mono text-xs tabular-nums' : 'text-sm font-medium'}>
            {value}
          </div>
          {copyValue && <CopyButton value={copyValue} label={label} />}
        </div>
      </div>
    </div>
  );
}

function dangerClass(danger: SignatureDanger): string {
  if (danger === 'high') return 'alert-error';
  if (danger === 'medium') return 'alert-warning';
  if (danger === 'low') return 'alert-info';
  return '';
}

function badgeClass(danger: SignatureDanger): string {
  if (danger === 'high') return 'badge-error';
  if (danger === 'medium') return 'badge-warning';
  if (danger === 'low') return 'badge-info';
  return 'badge-ghost';
}

function riskTitle(t: ReturnType<typeof useI18n>['t'], kind: SignatureRiskKind) {
  const copy = t.signatureRisk;
  if (kind === 'erc20-permit') return copy.riskTitles.erc20Permit;
  if (kind === 'nft-order') return copy.riskTitles.nftOrder;
  return copy.riskTitles[kind];
}

function riskExplain(t: ReturnType<typeof useI18n>['t'], kind: SignatureRiskKind) {
  const copy = t.signatureRisk;
  if (kind === 'erc20-permit') return copy.riskExplains.erc20Permit;
  if (kind === 'nft-order') return copy.riskExplains.nftOrder;
  return copy.riskExplains[kind];
}

function OrderBalanceCard({ summary }: { summary: OrderSummary }) {
  const { t } = useI18n();
  const breakdown = t.signatureRisk.orderBreakdown;

  return (
    <div className="card border border-base-300 bg-base-200">
      <div className="card-body gap-4 p-4 sm:p-5">
        <h2 className="card-title text-lg">{breakdown.title}</h2>

        {summary.zeroReturnToOfferer && (
          <div role="alert" className="alert alert-error text-sm">
            <span>{breakdown.zeroReturnWarning}</span>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0 rounded-box border border-error/25 bg-base-100/60 p-3.5">
            <div className="mb-2.5 text-sm font-semibold text-error">{breakdown.give}</div>
            <OrderItemList items={summary.give} tone="give" />
          </div>

          <div className="min-w-0 rounded-box border border-base-300 bg-base-100/60 p-3.5">
            <div className="mb-2.5 text-sm font-semibold text-success">{breakdown.receive}</div>
            {summary.receiveByOfferer.length > 0 ? (
              <OrderItemList items={summary.receiveByOfferer} tone="receive" />
            ) : (
              <p className="text-xs text-base-content/70">{breakdown.noOffererReturn}</p>
            )}

            {summary.receiveByOthers.length > 0 && (
              <div className="mt-3 border-t border-base-300 pt-3">
                <div className="mb-2 text-xs font-medium text-warning">
                  {breakdown.toThirdParty}
                </div>
                <OrderItemList items={summary.receiveByOthers} tone="other" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderItemList({
  items,
  tone,
}: {
  items: OrderAssetItem[];
  tone: 'give' | 'receive' | 'other';
}) {
  const { t } = useI18n();
  const breakdown = t.signatureRisk.orderBreakdown;

  if (items.length === 0) {
    return <p className="text-xs text-base-content/60">{breakdown.empty}</p>;
  }

  const badgeTone =
    tone === 'give'
      ? 'badge-error badge-outline'
      : tone === 'receive'
        ? 'badge-success badge-outline'
        : 'badge-warning badge-outline';

  return (
    <ul className="space-y-2.5">
      {items.map((item, idx) => {
        const amount = formatOrderAmount(item);
        const showZeroToken =
          item.token && item.token !== '0x0000000000000000000000000000000000000000';
        const showTokenId =
          item.identifierOrCriteria !== undefined &&
          (item.identifierOrCriteria !== '0' ||
            item.itemType === 'erc721' ||
            item.itemType === 'erc1155');

        return (
          <li
            key={`${tone}-${idx}-${item.token ?? 'none'}`}
            className="min-w-0 rounded-box border border-base-300/80 bg-base-200/70 p-2.5 text-xs"
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <span className={`badge badge-xs ${badgeTone}`}>
                {breakdown.itemTypes[item.itemType]}
              </span>
              {amount && (
                <span className="font-mono text-base-content/85">
                  {breakdown.amount}: {amount}
                </span>
              )}
              {showTokenId && (
                <span className="font-mono text-base-content/75">
                  #{item.identifierOrCriteria}
                </span>
              )}
            </div>

            {showZeroToken && item.token && (
              <div className="flex min-w-0 items-center justify-between gap-1.5">
                <span className="min-w-0 break-all font-mono text-[11px] text-base-content/75">
                  {item.token}
                </span>
                <CopyButton value={item.token} label={breakdown.itemTypes[item.itemType]} />
              </div>
            )}

            {item.recipient && (
              <div className="mt-1 flex min-w-0 items-center justify-between gap-1.5 text-[11px] text-base-content/75">
                <span className="min-w-0 break-all font-mono">
                  {breakdown.recipient}: {item.recipient}
                </span>
                <CopyButton value={item.recipient} label={breakdown.recipient} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function formatOrderAmount(item: OrderAssetItem): string | undefined {
  if (!item.startAmount && !item.endAmount) return undefined;
  if (item.startAmount && item.endAmount && item.startAmount !== item.endAmount) {
    return `${item.startAmount} → ${item.endAmount}`;
  }
  return item.startAmount ?? item.endAmount;
}
