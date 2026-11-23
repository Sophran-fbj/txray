'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAccount, useEnsAddress } from 'wagmi';
import { getAddress, isAddress, type Address } from 'viem';
import { normalize } from 'viem/ens';
import { AppShell } from '@/components/AppShell';
import { CopyButton } from '@/components/CopyButton';
import { WalletButton } from '@/components/WalletButton';
import { useApprovals } from '@/features/txray/approvals/useApprovals';
import { useAccountDelegation } from '@/features/txray/approvals/useAccountDelegation';
import { useSpenderRisk } from '@/features/txray/approvals/useSpenderRisk';
import {
  DEMO_OWNER,
  demoApprovals,
  demoRiskMap,
} from '@/features/txray/approvals/demoApprovals';
import {
  DEFAULT_TXRAY_CHAIN_ID,
  TXRAY_CHAINS,
  getTxRayChain,
  isSupportedTxRayChain,
  explorerAddressUrl,
  explorerTxUrl,
} from '@/features/txray/chains/chains';
import { useTokenPrices } from '@/features/txray/approvals/useTokenPrices';
import { ApprovalRow } from '@/features/txray/approvals/ApprovalRow';
import { useI18n } from '@/lib/i18n/provider';
import type { ApprovalWarning } from '@/features/txray/approvals/types';
import type { VerifiedRevocation } from '@/features/txray/approvals/useRevokeApproval';
import {
  formatUsd,
  selectApprovals,
  summarizeApprovals,
  type ApprovalFilter,
  type ApprovalSort,
} from '@/features/txray/approvals/viewOptions';

export default function ApprovalsPage() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <AppShell maxWidth="5xl" headerRight={<WalletButton />}>
          <div className="card border border-base-300 bg-base-200">
            <div className="card-body items-center gap-3 text-base-content/70">
              <span
                className="loading loading-spinner loading-md text-primary"
                aria-hidden="true"
              />
              <span>{t.approvals.loadingPage}</span>
            </div>
          </div>
        </AppShell>
      }
    >
      <ApprovalsContent />
    </Suspense>
  );
}

function ApprovalsContent() {
  const { locale, t } = useI18n();
  const searchParams = useSearchParams();
  const demoMode = searchParams.get('demo') === '1';
  const initialChainParam = Number(searchParams.get('chain'));
  const initialAddressParam = searchParams.get('address') ?? '';
  const { address: connected, chainId: walletChainId } = useAccount();
  const [input, setInput] = useState(() => (demoMode ? '' : initialAddressParam));
  const [selectedChainId, setSelectedChainId] = useState(() =>
    !demoMode && isSupportedTxRayChain(initialChainParam)
      ? initialChainParam
      : DEFAULT_TXRAY_CHAIN_ID,
  );
  const [filter, setFilter] = useState<ApprovalFilter>('all');
  const [sort, setSort] = useState<ApprovalSort>('risk');
  const [lastRevocation, setLastRevocation] = useState<VerifiedRevocation>();
  const effectiveChainId = demoMode ? DEFAULT_TXRAY_CHAIN_ID : selectedChainId;
  const chain = getTxRayChain(effectiveChainId);

  const trimmed = input.trim();
  const looksLikeEns = trimmed.toLowerCase().endsWith('.eth');
  const normalizedEns = looksLikeEns ? safeNormalize(trimmed) : undefined;

  const { data: ensResolved, isLoading: ensLoading } = useEnsAddress({
    name: normalizedEns,
    chainId: 1,
    query: { enabled: !!normalizedEns },
  });

  let target: Address | undefined;
  let inputError: string | undefined;
  if (trimmed) {
    if (isAddress(trimmed)) target = getAddress(trimmed);
    else if (looksLikeEns) target = ensResolved ?? undefined;
    else inputError = t.approvals.invalidAddress;
  } else {
    target = demoMode ? DEMO_OWNER : connected;
  }

  useEffect(() => {
    if (demoMode) return;
    const params = new URLSearchParams(window.location.search);
    params.delete('demo');
    if (selectedChainId !== DEFAULT_TXRAY_CHAIN_ID) {
      params.set('chain', String(selectedChainId));
    } else {
      params.delete('chain');
    }
    if (trimmed && target) {
      params.set('address', trimmed);
    } else {
      params.delete('address');
    }
    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [demoMode, selectedChainId, trimmed, target]);

  const approvalsQuery = useApprovals(demoMode ? undefined : target, effectiveChainId);
  const delegationQuery = useAccountDelegation(demoMode ? undefined : target, effectiveChainId);
  const delegation = demoMode ? undefined : delegationQuery.data;
  const scanResult = demoMode
    ? { approvals: demoApprovals, status: 'complete' as const, warnings: [] }
    : approvalsQuery.data;
  const approvals = scanResult?.approvals;
  const isLoading = demoMode ? false : approvalsQuery.isLoading;
  const isError = demoMode ? false : approvalsQuery.isError;
  const coverage = demoMode ? undefined : approvalsQuery.data?.index.coverage;
  const continuation = approvalsQuery.continuation;
  const verifiedRevocation = !demoMode && lastRevocation?.chainId === effectiveChainId &&
    lastRevocation.owner.toLowerCase() === target?.toLowerCase() ? lastRevocation : undefined;

  // 唯一 spender 列表（包含 EIP-7702 委托目标合约）→ 风险画像
  const spenders = useMemo(() => {
    const list = approvals ? approvals.map((a) => a.spender) : [];
    if (delegation?.status === 'delegated') {
      list.push(delegation.delegate);
    }
    return Array.from(new Set(list));
  }, [approvals, delegation]);
  const {
    data: liveRiskMap,
    isError: isRiskError,
  } = useSpenderRisk(demoMode ? [] : spenders, effectiveChainId);
  const riskMap = demoMode ? demoRiskMap : liveRiskMap;
  const delegateRisk =
    delegation?.status === 'delegated'
      ? riskMap?.[delegation.delegate.toLowerCase()]
      : undefined;
  const threatStatuses = Object.values(liveRiskMap ?? {}).map((risk) => risk.threat);
  const checkedThreats = threatStatuses.filter((threat) => threat.status === 'available');
  const threatStatus = checkedThreats[0];
  const threatCheckedAt = checkedThreats.reduce<number | undefined>((oldest, { checkedAt }) => {
    if (checkedAt === undefined) return oldest;
    return oldest === undefined ? checkedAt : Math.min(oldest, checkedAt);
  }, undefined);
  const pricedTokens = useMemo(
    () =>
      approvals
        ? approvals
            .filter((a) => a.kind !== 'nft' && a.kind !== 'nft-token')
            .map((a) => a.token)
        : [],
    [approvals],
  );
  const { data: tokenPriceResult } = useTokenPrices(
    effectiveChainId,
    demoMode ? [] : pricedTokens,
  );
  const summary = useMemo(
    () => summarizeApprovals(approvals ?? [], riskMap, tokenPriceResult?.prices),
    [approvals, riskMap, tokenPriceResult?.prices],
  );
  const visibleApprovals = useMemo(
    () => selectApprovals(approvals ?? [], riskMap, tokenPriceResult?.prices, filter, sort),
    [approvals, riskMap, tokenPriceResult?.prices, filter, sort],
  );

  const canRevoke =
    !demoMode &&
    !!connected &&
    !!target &&
    connected.toLowerCase() === target.toLowerCase();
  const hasPermit2 = approvals?.some((a) => a.kind === 'permit2');

  const showThreatPartial = !demoMode && !isRiskError && checkedThreats.length < threatStatuses.length;
  const showThreatCoverage = !demoMode && !isRiskError && threatStatus?.status === 'available';
  const showPriceNotice =
    tokenPriceResult?.coverage.status === 'unavailable' ||
    tokenPriceResult?.coverage.status === 'partial';
  const showDelegationUnavailable = !demoMode && delegation?.status === 'unavailable';
  const hasCoverageDetails =
    isRiskError || showThreatPartial || showThreatCoverage || showPriceNotice || showDelegationUnavailable;

  const filterPills: Array<{
    key: ApprovalFilter;
    label: string;
    title: string;
    count: number;
  }> = [
    { key: 'all', label: t.approvals.summary.filterShortAll, title: t.approvals.filterAll, count: summary.total },
    { key: 'attention', label: t.approvals.summary.filterShortAttention, title: t.approvals.filterAttention, count: summary.attention },
    { key: 'broad', label: t.approvals.summary.filterShortBroad, title: t.approvals.filterBroad, count: summary.broad },
  ];

  return (
    <AppShell maxWidth="5xl" headerRight={<WalletButton />} footerNote={t.approvals.readonlyNotice}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">
            {t.approvals.title}
          </h1>
          <p className="mt-1 text-sm text-base-content/70">
            {t.approvals.currentNetwork(chain.name)}
          </p>
        </div>
        {!demoMode && (
          <Link
            href="/tools/txray/approvals?demo=1"
            className="btn btn-outline btn-xs border-base-300 text-base-content/75 hover:border-primary/40 hover:text-base-content"
          >
            {t.approvals.summary.tryDemo}
          </Link>
        )}
      </div>

      {demoMode && (
        <div className="alert alert-info mt-5 text-sm">
          <span>{t.approvals.demo}</span>
        </div>
      )}

      <section className="mt-5 rounded-box border border-base-300 bg-base-200 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <div className="form-control">
            <label className="label py-1" htmlFor="approval-network">
              <span className="label-text text-xs font-medium">{t.approvals.network}</span>
            </label>
            <select
              id="approval-network"
              className="select select-bordered select-sm w-full sm:select-md"
              disabled={demoMode}
              value={effectiveChainId}
              onChange={(e) => setSelectedChainId(Number(e.target.value))}
            >
              {TXRAY_CHAINS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <span className="mt-1 text-[11px] text-base-content/60">
              {t.approvals.supportedNetworks}
            </span>
          </div>

          <div className="form-control">
            <label className="label py-1" htmlFor="approval-address">
              <span className="label-text text-xs font-medium">{t.approvals.queryAddress}</span>
              <span className="label-text-alt text-[11px] text-base-content/65">
                {t.approvals.queryAddressHint}
              </span>
            </label>
            <input
              id="approval-address"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.approvals.addressPlaceholder}
              className="input input-bordered input-sm w-full font-mono sm:input-md"
              spellCheck={false}
            />
            {inputError && (
              <span className="mt-1 text-xs text-error" role="alert">{inputError}</span>
            )}
            {looksLikeEns && ensLoading && (
              <span className="mt-1 text-xs text-base-content/70" role="status">
                {t.approvals.resolvingEns}
              </span>
            )}
            {looksLikeEns && !ensLoading && !ensResolved && (
              <span className="mt-1 text-xs text-warning" role="alert">
                {t.approvals.ensFailed}
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-base-300/70 pt-3 text-xs">
          {target ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-base-content/70">{t.approvals.querying}</span>
              <span className="break-all font-mono text-primary">{target}</span>
              <CopyButton value={target} />
              {!demoMode && (
                <CopyButton
                  value={() => {
                    const params = new URLSearchParams({
                      chain: String(effectiveChainId),
                      address: trimmed || target,
                    });
                    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
                  }}
                  text={t.common.copyLink}
                  copiedText={t.common.linkCopied}
                  className="border border-base-300"
                />
              )}
              {!trimmed && connected && (
                <span className="badge badge-sm">{t.approvals.connectedWallet}</span>
              )}
              {delegation?.status === 'eoa' && (
                <span className="badge badge-ghost badge-sm text-base-content/70">
                  {t.approvals.eip7702.cleanStatus}
                </span>
              )}
              {delegation?.status === 'contract' && (
                <span className="badge badge-ghost badge-sm text-base-content/70">
                  {t.approvals.eip7702.contractStatus}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-base-content/75">
              <span>{t.approvals.startHint}</span>
            </div>
          )}
          {target && !canRevoke && (
            <span className="text-base-content/65">{t.approvals.readonlyMode}</span>
          )}
        </div>
      </section>

      {target && (
        <div className="mt-6">
          {delegation?.status === 'delegated' && (
            <section
              aria-label={t.approvals.eip7702.detectedTitle}
              className={`mb-4 rounded-box border p-4 text-sm ${
                !isRiskError && delegateRisk?.level === 'known'
                  ? 'border-warning/60 bg-warning/10'
                  : 'border-error/60 bg-error/10'
              }`}
              data-testid="eip7702-delegation-alert"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-base-content">
                  {t.approvals.eip7702.detectedTitle}
                </span>
                {delegateRisk && (
                  <span
                    className={`badge badge-sm ${
                      delegateRisk.level === 'malicious' || delegateRisk.level === 'eoa'
                        ? 'badge-error'
                        : delegateRisk.level === 'known'
                          ? 'badge-success'
                          : 'badge-warning'
                    }`}
                  >
                    {delegateRisk.level === 'malicious'
                      ? t.approvals.riskMalicious
                      : delegateRisk.level === 'known'
                        ? delegateRisk.labelName
                        : delegateRisk.level === 'new'
                          ? t.approvals.riskNew
                          : t.approvals.riskUnknown}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs leading-5 text-base-content/80">
                {t.approvals.eip7702.detectedDescription}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-base-content/70">{t.approvals.eip7702.delegateLabel}:</span>
                <a
                  href={explorerAddressUrl(effectiveChainId, delegation.delegate)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link link-hover break-all font-mono text-primary"
                >
                  {delegation.delegate}
                </a>
                <CopyButton value={delegation.delegate} label={t.approvals.eip7702.delegateLabel} />
                <Link
                  href="/articles/eip-7702-delegated-eoa-risk"
                  className="link ml-auto font-medium text-primary"
                >
                  {t.approvals.eip7702.learnMore} →
                </Link>
              </div>
            </section>
          )}

          {verifiedRevocation && (
            <div className="alert alert-success mb-4 text-sm" role="status">
              <span>{t.approvals.revokedNotice(verifiedRevocation.symbol)}</span>
              <a
                className="link"
                href={explorerTxUrl(effectiveChainId, verifiedRevocation.hash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.approvals.viewTransaction}
              </a>
            </div>
          )}

          {isLoading && (
            <div className="card border border-base-300 bg-base-200" role="status">
              <div className="card-body items-center gap-3 text-base-content/70">
                <span
                  className="loading loading-spinner loading-md text-primary"
                  aria-hidden="true"
                />
                <span>{t.approvals.scanning}</span>
              </div>
            </div>
          )}

          {isError && (
            <div className="alert alert-error mb-4" role="alert">
              <span className="text-sm">
                {t.approvals.queryFailed}
                <br />
                <span className="text-xs opacity-80">
                  {t.approvals.queryFailedDetail}
                </span>
              </span>
            </div>
          )}

          {scanResult?.status === 'partial' && (
            <div className="alert alert-warning mb-4" role="alert">
              <div className="text-sm">
                <div className="font-bold">{t.approvals.partialTitle}</div>
                <ul className="mt-1 list-disc pl-5">
                  {scanResult.warnings.map((warning) => (
                    <li key={warning.code}>
                      {formatApprovalWarning(warning, t.approvals)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {coverage?.snapshotBlock !== undefined && coverage.ranges && (
            <details
              className="mb-4 rounded-box border border-base-300 bg-base-200/70 p-3 text-sm"
              open={coverage.status === 'partial'}
            >
              <summary className="cursor-pointer font-medium">
                {t.approvals.scanCoverage(coverage.snapshotBlock.toLocaleString(locale))}
              </summary>
              <ul className="mt-2 divide-y divide-base-300">
                {coverage.ranges.map((range) => (
                  <li
                    key={`${range.source}:${range.fromBlock}:${range.toBlock}`}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
                  >
                    <span>
                      {t.approvals.scanSources[range.source]} ·{' '}
                      <span className="tabular-nums">
                        {range.fromBlock.toLocaleString(locale)}–{range.toBlock.toLocaleString(locale)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-base-content/70">
                        {t.approvals.scanRangeStatuses[range.status]}
                      </span>
                      {(range.status === 'pending' || range.status === 'failed') && (
                        <button
                          type="button"
                          className="btn btn-outline btn-xs"
                          disabled={continuation.isPending}
                          onClick={() => continuation.mutate(range)}
                        >
                          {range.status === 'failed'
                            ? t.approvals.scanRetryRange
                            : t.approvals.scanContinueRange}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {continuation.isPending && (
                <p className="mt-2 text-xs" role="status">{t.approvals.scanning}</p>
              )}
              {continuation.isError && (
                <p className="mt-2 text-xs text-error" role="alert">
                  {t.approvals.scanContinueFailed}
                </p>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-xs mt-2"
                disabled={continuation.isPending}
                onClick={() => void approvalsQuery.restart()}
              >
                {t.approvals.scanRestart}
              </button>
            </details>
          )}

          {hasCoverageDetails && (
            <div
              className="mb-4 space-y-1.5 rounded-box border border-base-300 bg-base-200/70 px-4 py-3 text-xs"
              aria-label={t.approvals.summary.scanHealthTitle}
            >
              {showDelegationUnavailable && (
                <p className="text-warning" role="status">
                  ⚠ {t.approvals.eip7702.unavailableNotice}
                </p>
              )}
              {isRiskError && (
                <p className="text-warning" role="alert">
                  ⚠ {t.approvals.riskUnavailable}
                </p>
              )}
              {showThreatPartial && (
                <p className="text-warning" role="alert">
                  ⚠{' '}
                  {checkedThreats.length > 0
                    ? t.approvals.threatPartial(checkedThreats.length, threatStatuses.length)
                    : t.approvals.threatUnavailable}
                </p>
              )}
              {showThreatCoverage && (
                <p className="text-base-content/70">
                  {t.approvals.threatCoverage}:{' '}
                  <a
                    className="link link-hover"
                    href={threatStatus.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {threatStatus.sourceName}
                  </a>
                  {' · '}
                  {t.approvals.threatSourceDelay(threatStatus.publicDelayDays)}
                  {threatCheckedAt !== undefined && (
                    <>
                      {' · '}
                      {t.approvals.threatCheckedAt(
                        new Date(threatCheckedAt).toLocaleString(
                          locale === 'zh' ? 'zh-CN' : 'en-US',
                        ),
                      )}
                    </>
                  )}
                  {checkedThreats.some((threat) => threat.stale) && ` · ${t.approvals.threatSourceStale}`}
                </p>
              )}
              {tokenPriceResult?.coverage.status === 'unavailable' && (
                <p className="text-warning" role="status">
                  ⚠ {t.approvals.priceUnavailable}
                </p>
              )}
              {tokenPriceResult?.coverage.status === 'partial' && (
                <p className="text-warning" role="status">
                  ⚠{' '}
                  {t.approvals.pricePartial(
                    tokenPriceResult.coverage.priced,
                    tokenPriceResult.coverage.requested,
                    tokenPriceResult.coverage.omitted,
                  )}
                </p>
              )}
            </div>
          )}

          {scanResult?.status === 'complete' && approvals?.length === 0 && (
            <div className="card border border-base-300 bg-base-200">
              <div className="card-body items-center text-center">
                <p className="text-lg font-medium">{t.approvals.cleanTitle}</p>
                <p className="max-w-lg text-sm text-base-content/70">
                  {t.approvals.cleanDescription}
                </p>
              </div>
            </div>
          )}

          {approvals && approvals.length > 0 && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-box border border-base-300 bg-base-200 p-3.5">
                  <div className="text-xs text-base-content/65">
                    {t.approvals.summary.activeLabel}
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-base-content">
                    {approvals.length}
                  </div>
                  <div className="mt-0.5 text-xs text-base-content/65">
                    {t.approvals.approvalCount(approvals.length)}
                  </div>
                </div>

                <div className="rounded-box border border-base-300 bg-base-200 p-3.5">
                  <div className="text-xs text-base-content/65">
                    {t.approvals.summary.attentionLabel}
                  </div>
                  <div
                    className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                      summary.highRiskSpender > 0
                        ? 'text-error'
                        : summary.attention > 0
                          ? 'text-warning'
                          : 'text-success'
                    }`}
                  >
                    {summary.attention}
                  </div>
                  <div className="mt-0.5 text-xs text-base-content/65">
                    {t.approvals.summary.filterShortAttention}
                  </div>
                </div>

                <div className="rounded-box border border-base-300 bg-base-200 p-3.5">
                  <div className="text-xs text-base-content/65">
                    {t.approvals.summary.broadLabel}
                  </div>
                  <div
                    className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                      summary.broad > 0 ? 'text-warning' : 'text-base-content'
                    }`}
                  >
                    {summary.broad}
                  </div>
                  <div className="mt-0.5 text-xs text-base-content/65">
                    {t.approvals.summary.filterShortBroad}
                  </div>
                </div>

                <div className="rounded-box border border-base-300 bg-base-200 p-3.5">
                  <div className="text-xs text-base-content/65">
                    {t.approvals.summary.exposureLabel}
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-base-content">
                    {summary.pricedCount > 0 ? `≈ $${formatUsd(summary.pricedExposureUsd)}` : '—'}
                  </div>
                  <div className="mt-0.5 text-xs text-base-content/65">
                    {summary.pricedCount === 0
                      ? t.approvals.summary.exposureUnavailable
                      : summary.unpricedCount > 0
                        ? t.approvals.summary.exposureUnpricedNote(summary.unpricedCount)
                        : 'USD'}
                    {summary.pricedCount === 0 && summary.unpricedCount > 0
                      ? ` · ${t.approvals.summary.exposureUnpricedNote(summary.unpricedCount)}`
                      : ''}
                  </div>
                </div>
              </div>

              {hasPermit2 && (
                <details className="collapse-arrow collapse mb-4 border border-base-300 bg-base-200 text-sm">
                  <summary className="collapse-title font-medium">
                    {t.approvals.permit2Title}
                  </summary>
                  <div className="collapse-content text-base-content/75">
                    {t.approvals.permit2Description}
                  </div>
                </details>
              )}

              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div
                  role="group"
                  aria-label={t.approvals.filterLabel}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  {filterPills.map((item) => {
                    const active = filter === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        title={item.title}
                        aria-pressed={active}
                        onClick={() => setFilter(item.key)}
                        className={`btn btn-xs sm:btn-sm ${
                          active
                            ? 'btn-primary'
                            : 'border-base-300 bg-base-200 text-base-content/80 hover:border-primary/40 hover:bg-base-300/60'
                        }`}
                      >
                        <span>{item.label}</span>
                        <span className="font-mono text-[11px] tabular-nums opacity-75">
                          {item.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <label
                    className="whitespace-nowrap text-xs text-base-content/70"
                    htmlFor="approval-sort"
                  >
                    {t.approvals.sortLabel}
                  </label>
                  <select
                    id="approval-sort"
                    className="select select-bordered select-sm w-full sm:w-52"
                    value={sort}
                    onChange={(event) => setSort(event.target.value as ApprovalSort)}
                  >
                    <option value="risk">{t.approvals.sortRisk}</option>
                    <option value="exposure">{t.approvals.sortExposure}</option>
                    <option value="asset">{t.approvals.sortAsset}</option>
                  </select>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-base-content/70">
                <p role="status">
                  {t.approvals.visibleCount(visibleApprovals.length, approvals.length)}
                  {sort === 'exposure' && ` · ${t.approvals.exposureSortNote}`}
                </p>
                {canRevoke && <p>{t.approvals.revokeEffect}</p>}
              </div>

              <div className="rounded-box border border-base-300 bg-base-200/40 md:overflow-x-auto">
                <table className="table block md:table" aria-label={t.approvals.title}>
                  <thead className="hidden bg-base-200 md:table-header-group">
                    <tr>
                      <th>{t.approvals.asset}</th>
                      <th>{t.approvals.spenderRisk}</th>
                      <th className="text-right">{t.approvals.allowance}</th>
                      <th className="text-right">{t.approvals.action}</th>
                    </tr>
                  </thead>
                  <tbody className="block space-y-3 p-3 md:table-row-group md:space-y-0 md:p-0">
                    {visibleApprovals.map((a) => (
                      <ApprovalRow
                        key={`${effectiveChainId}:${target.toLowerCase()}:${a.id}`}
                        approval={a}
                        canRevoke={canRevoke}
                        chainId={effectiveChainId}
                        connected={connected}
                        walletChainId={walletChainId}
                        riskUnavailable={isRiskError}
                        usdPrice={
                          a.kind === 'nft' || a.kind === 'nft-token'
                            ? undefined
                            : tokenPriceResult?.prices[a.token.toLowerCase()]
                        }
                        risk={riskMap?.[a.spender.toLowerCase()]}
                        onRevoked={setLastRevocation}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {visibleApprovals.length === 0 && (
                <p className="mt-3 text-sm text-base-content/70">
                  {t.approvals.noFilterResults}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}

function formatApprovalWarning(
  warning: ApprovalWarning,
  messages: ReturnType<typeof useI18n>['t']['approvals'],
): string {
  switch (warning.code) {
    case 'index-truncated':
      return messages.warningIndexTruncated(warning.maxRecordsPerSource);
    case 'index-ranges-incomplete':
      return messages.warningIndexRanges;
    case 'current-reads-failed':
      return messages.warningCurrentReads(warning.count);
    case 'decimals-failed':
      return messages.warningDecimals(warning.count);
    case 'balances-failed':
      return messages.warningBalances(warning.count);
  }
}

function safeNormalize(name: string): string | undefined {
  try {
    return normalize(name);
  } catch {
    return undefined;
  }
}
