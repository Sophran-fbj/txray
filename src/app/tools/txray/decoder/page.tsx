'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getAddress, isAddress, type Address } from 'viem';
import { AppShell } from '@/components/AppShell';
import { CopyButton } from '@/components/CopyButton';
import { WalletButton } from '@/components/WalletButton';
import {
  isMaxUintValue,
  isTxHash,
  isCalldata,
  useDecoder,
  type DecoderInputMode,
  type DecodedParam,
  type DecodedResult,
} from '@/features/txray/decoder/useDecoder';
import CallTreeView, { useCallTree } from '@/features/txray/decoder/CallTreeView';
import { TransactionExecutionView } from '@/features/txray/decoder/TransactionExecutionView';
import { getSpenderLabel } from '@/features/txray/approvals/spenderLabels';
import {
  DEFAULT_TXRAY_CHAIN_ID,
  TXRAY_CHAINS,
  isSupportedTxRayChain,
  explorerAddressUrl,
} from '@/features/txray/chains/chains';
import { useI18n } from '@/lib/i18n/provider';
import { pickText } from '@/content/articles';
import { getRiskCase } from '@/content/riskCases';
import {
  APPROVE_EXAMPLE,
  NESTED_MULTICALL_EXAMPLE,
} from '@/features/txray/decoder/examples';

const LONG_VALUE_THRESHOLD = 160;
const LONG_VALUE_PREVIEW = 120;
const MAX_URL_CALLDATA_CHARS = 4096;

function buildDecoderShareUrl(
  origin: string,
  pathname: string,
  opts: {
    activeCaseId?: string;
    chainId: number;
    mode: DecoderInputMode;
    value: string;
    targetAddress?: Address;
  },
): string {
  const params = new URLSearchParams();
  if (opts.activeCaseId) {
    params.set('case', opts.activeCaseId);
  } else {
    if (opts.chainId !== DEFAULT_TXRAY_CHAIN_ID) {
      params.set('chain', String(opts.chainId));
    }
    if (opts.mode === 'tx') {
      params.set('tx', opts.value);
    } else {
      params.set('calldata', opts.value);
      if (opts.targetAddress) params.set('target', opts.targetAddress);
    }
  }
  const qs = params.toString();
  return `${origin}${pathname}${qs ? `?${qs}` : ''}`;
}

export default function DecoderPage() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <AppShell maxWidth="5xl" headerRight={<WalletButton />} footerNote={t.decoder.readonly}>
          <div className="card border border-base-300 bg-base-200">
            <div className="card-body items-center gap-3 text-base-content/70">
              <span
                className="loading loading-spinner loading-md text-primary"
                aria-hidden="true"
              />
              <span>{t.decoder.loading}</span>
            </div>
          </div>
        </AppShell>
      }
    >
      <DecoderContent />
    </Suspense>
  );
}

function DecoderContent() {
  const { locale, t } = useI18n();
  const searchParams = useSearchParams();
  const initialCaseParam = searchParams.get('case') ?? '';
  const initialMatchedCase = getRiskCase(initialCaseParam);
  const initialDecoderCase =
    initialMatchedCase?.tool === 'decoder' ? initialMatchedCase : undefined;

  const initialTxParam = initialDecoderCase ? '' : (searchParams.get('tx') ?? '');
  const initialCalldataParam = initialDecoderCase
    ? initialDecoderCase.calldata
    : (searchParams.get('calldata') ?? '');
  const initialTargetParam = initialDecoderCase
    ? (initialDecoderCase.target ?? '')
    : (searchParams.get('target') ?? '');
  const initialChainParam = Number(searchParams.get('chain'));
  const hasInitialCalldata =
    Boolean(initialDecoderCase) || (!initialTxParam && Boolean(initialCalldataParam));

  const [activeCaseId, setActiveCaseId] = useState<string | null>(
    () => initialDecoderCase?.id ?? null,
  );
  const activeCase = activeCaseId ? getRiskCase(activeCaseId) : undefined;
  const activeDecoderCase = activeCase?.tool === 'decoder' ? activeCase : undefined;

  const [mode, setMode] = useState<DecoderInputMode>(() =>
    hasInitialCalldata ? 'calldata' : 'tx',
  );
  const [txInput, setTxInput] = useState(() => initialTxParam);
  const [calldataInput, setCalldataInput] = useState(() =>
    hasInitialCalldata ? initialCalldataParam : '',
  );
  const [calldataTarget, setCalldataTarget] = useState(() =>
    hasInitialCalldata ? initialTargetParam : '',
  );
  const [chainId, setChainId] = useState(() =>
    initialDecoderCase?.chainId ??
    (isSupportedTxRayChain(initialChainParam) ? initialChainParam : DEFAULT_TXRAY_CHAIN_ID),
  );
  const input = mode === 'tx' ? txInput : calldataInput;
  const targetValue = calldataTarget.trim();
  const targetAddress = isAddress(targetValue) ? getAddress(targetValue) : undefined;
  const { callQuery, transactionQuery } = useDecoder(input, chainId, mode, targetAddress);
  const transaction = transactionQuery.data;
  const data = callQuery.data;
  const value = input.trim();
  const inputValid = mode === 'tx' ? isTxHash(value) : isCalldata(value);
  const showResult = inputValid;
  const shareableInUrl =
    inputValid && (mode === 'tx' || value.length <= MAX_URL_CALLDATA_CHARS);

  useEffect(() => {
    const params = new URLSearchParams();
    if (activeDecoderCase) {
      params.set('case', activeDecoderCase.id);
    } else {
      if (chainId !== DEFAULT_TXRAY_CHAIN_ID) {
        params.set('chain', String(chainId));
      }
      if (mode === 'tx' && isTxHash(value)) {
        params.set('tx', value);
      }
    }
    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [activeDecoderCase, chainId, mode, value]);

  return (
    <AppShell maxWidth="5xl" headerRight={<WalletButton />} footerNote={t.decoder.readonly}>
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">
          {t.decoder.title}
        </h1>
        <p className="mt-1 text-sm text-base-content/70">
          {t.decoder.description}
        </p>
      </div>

      {activeDecoderCase && (
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
                href={`/articles/${activeDecoderCase.articleSlug}`}
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
            {pickText(activeDecoderCase.title, locale)}
          </h2>
          <p className="mt-1 text-xs leading-5 text-base-content/80">
            <span className="font-semibold text-warning">{t.cases.lureLabel}: </span>
            {pickText(activeDecoderCase.lure, locale)}
          </p>
          <p className="mt-1 text-xs leading-5 text-base-content/80">
            <span className="font-semibold text-primary">{t.cases.txrayFindsLabel}: </span>
            {pickText(activeDecoderCase.whatTxRayFinds, locale)}
          </p>
        </div>
      )}

      <section className="mt-5 rounded-box border border-base-300 bg-base-200 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <fieldset>
            <legend className="label-text mb-1.5 block text-xs font-medium">
              {t.decoder.inputType}
            </legend>
            <div className="join" aria-label={t.decoder.inputType}>
              <button
                type="button"
                className={`btn join-item btn-sm ${mode === 'tx' ? 'btn-primary' : 'btn-outline border-base-300'}`}
                aria-pressed={mode === 'tx'}
                onClick={() => {
                  setActiveCaseId(null);
                  setMode('tx');
                }}
              >
                {t.decoder.txMode}
              </button>
              <button
                type="button"
                className={`btn join-item btn-sm ${mode === 'calldata' ? 'btn-primary' : 'btn-outline border-base-300'}`}
                aria-pressed={mode === 'calldata'}
                onClick={() => {
                  setActiveCaseId(null);
                  setMode('calldata');
                }}
              >
                {t.decoder.calldataMode}
              </button>
            </div>
          </fieldset>

          <div className="form-control sm:w-52">
            <label className="label py-1" htmlFor="decoder-network">
              <span className="label-text text-xs font-medium">{t.decoder.network}</span>
            </label>
            <select
              id="decoder-network"
              className="select select-bordered select-sm w-full"
              value={chainId}
              onChange={(event) => setChainId(Number(event.target.value))}
            >
              {TXRAY_CHAINS.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-control mt-4">
          <label className="label py-1" htmlFor="decoder-input">
            <span className="label-text text-xs font-medium">
              {mode === 'tx' ? t.decoder.txMode : t.decoder.calldataMode}
            </span>
          </label>
          <textarea
            id="decoder-input"
            value={input}
            onChange={(event) => {
              setActiveCaseId(null);
              if (mode === 'tx') {
                setTxInput(event.target.value);
              } else {
                setCalldataInput(event.target.value);
              }
            }}
            placeholder={mode === 'tx' ? t.decoder.txPlaceholder : t.decoder.calldataPlaceholder}
            className="textarea textarea-bordered min-h-24 w-full break-all font-mono text-sm"
            spellCheck={false}
            aria-invalid={value.length > 0 && !inputValid}
            aria-describedby="decoder-input-help"
          />
          <p id="decoder-input-help" className="mt-1.5 text-xs text-base-content/70">
            {mode === 'tx' ? t.decoder.txHelp : t.decoder.calldataHelp}
          </p>
          {value.length > 0 && !inputValid && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-sm text-error" role="alert">
                {mode === 'tx' ? t.decoder.invalidTxHash : t.decoder.invalidCalldata}
              </p>
              {mode === 'tx' && isCalldata(value) && (
                <button
                  type="button"
                  className="btn btn-outline btn-xs border-primary/40 text-primary"
                  onClick={() => {
                    setCalldataInput(value);
                    setTxInput('');
                    setMode('calldata');
                  }}
                >
                  {t.decoder.switchToCalldataHint}
                </button>
              )}
              {mode === 'calldata' && isTxHash(value) && (
                <button
                  type="button"
                  className="btn btn-outline btn-xs border-primary/40 text-primary"
                  onClick={() => {
                    setTxInput(value);
                    setCalldataInput('');
                    setMode('tx');
                  }}
                >
                  {t.decoder.switchToTxHint}
                </button>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-base-content/60">{t.decoder.samplesLabel}:</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs border border-base-300 text-primary"
              onClick={() => {
                setActiveCaseId(null);
                setMode('calldata');
                setCalldataInput(APPROVE_EXAMPLE);
                setCalldataTarget('');
              }}
            >
              {t.decoder.approveSample}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs border border-base-300 text-secondary"
              onClick={() => {
                setActiveCaseId(null);
                setMode('calldata');
                setCalldataInput(NESTED_MULTICALL_EXAMPLE);
                setCalldataTarget('');
              }}
            >
              {t.decoder.callTreeSample}
            </button>
            {shareableInUrl && (
              <CopyButton
                value={() =>
                  buildDecoderShareUrl(window.location.origin, window.location.pathname, {
                    activeCaseId: activeDecoderCase?.id,
                    chainId,
                    mode,
                    value,
                    targetAddress,
                  })
                }
                text={t.common.copyLink}
                copiedText={t.common.linkCopied}
                className="ml-auto border border-base-300"
              />
            )}
          </div>

          {mode === 'calldata' && (
            <div className="form-control mt-4 border-t border-base-300/70 pt-3">
              <label className="label py-1" htmlFor="decoder-target">
                <span className="label-text text-xs font-medium">{t.decoder.calldataTarget}</span>
              </label>
              <input
                id="decoder-target"
                className="input input-bordered input-sm w-full font-mono"
                placeholder="0x…"
                value={calldataTarget}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setActiveCaseId(null);
                  setCalldataTarget(event.target.value);
                }}
                aria-invalid={Boolean(targetValue && !targetAddress)}
                aria-describedby="decoder-target-help"
              />
              <p className="mt-1 text-xs text-base-content/65" id="decoder-target-help">
                {t.decoder.calldataTargetHelp}
              </p>
              {targetValue && !targetAddress && (
                <p className="mt-1 text-xs text-error" role="alert">
                  {t.decoder.invalidTarget}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {showResult && (
        <div className="mt-6" aria-live="polite">
          {transaction && <TransactionExecutionView transaction={transaction} chainId={chainId} />}

          {transaction?.to && !isCalldata(transaction.input) && (
            <p className="text-sm text-base-content/70">{t.decoder.noCalldata}</p>
          )}

          {(transactionQuery.isLoading || callQuery.isLoading) && (
            <div className="card border border-base-300 bg-base-200" role="status">
              <div className="card-body items-center gap-3 text-base-content/70">
                <span
                  className="loading loading-spinner loading-md text-primary"
                  aria-hidden="true"
                />
                <span>{t.decoder.loading}</span>
              </div>
            </div>
          )}

          {(transactionQuery.isError || callQuery.isError) && (
            <div className="alert alert-error" role="alert">
              <span className="text-sm">
                {transactionQuery.isError ? t.decoder.txLookupFailed : t.decoder.calldataFailed}
              </span>
            </div>
          )}

          {data && (
            <>
              <p className="mb-4 text-sm text-base-content/70" role="status">
                {data.source === 'tx'
                  ? t.decoder.txResultNote
                  : data.to
                    ? t.decoder.calldataTargetNote
                    : t.decoder.calldataResultNote}
              </p>
              <DecodedView data={data} chainId={chainId} />
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}

function DecodedView({ data, chainId }: { data: DecodedResult; chainId: number }) {
  const { t } = useI18n();
  const tree = useCallTree({
    to: data.to,
    value: data.txValue ?? null,
    data: data.raw,
    selector: data.selector,
    signature: data.signature,
    verifiedCall: data.verifiedCall,
  });
  const dangerStyle =
    data.danger === 'high'
      ? 'alert-error'
      : data.danger === 'medium'
        ? 'alert-warning'
        : '';

  const functionCard = (
    <div className="card border border-base-300 bg-base-200">
      <div className="card-body gap-3 p-4 sm:p-6">
        <div>
          <div className="text-xs text-base-content/70">
            {t.decoder.function}
          </div>
          {data.functionName ? (
            <div className="font-mono text-lg font-semibold text-primary">
              {data.functionName}
            </div>
          ) : (
            <div className="break-words font-mono text-sm text-warning">
              {t.decoder.unknownFunction(data.selector)}
            </div>
          )}
          {data.signature && (
            <div className="mt-1 break-all font-mono text-xs text-base-content/70">
              {data.signature}
            </div>
          )}
          <p className="mt-1 text-xs text-base-content/70">
            {t.decoder.signatureSources[data.signatureSource]}
            {data.abiStatus && data.abiStatus !== 'matched' && ` · ${t.decoder.abiFallback[data.abiStatus]}`}
            {data.verifiedCall?.approvalInterface && ` · ${t.decoder.approvalInterfaces[data.verifiedCall.approvalInterface]}`}
            {data.verifiedCall?.viaProxyImplementation && ` · ${t.decoder.proxyImplementationNote}`}
          </p>
        </div>

        {data.source === 'calldata' && data.to && (
          <div>
            <div className="text-xs text-base-content/70">{t.decoder.targetContract}</div>
            <div className="mt-0.5 flex items-center gap-1">
              <AddressLink address={data.to} chainId={chainId} />
              <CopyButton value={data.to} label={t.decoder.targetContract} />
            </div>
          </div>
        )}

        {data.verifiedCall?.viaProxyImplementation && (
          <div>
            <div className="text-xs text-base-content/70">{t.decoder.implementationAddress}</div>
            <div className="mt-0.5 flex items-center gap-1">
              <AddressLink
                address={data.verifiedCall.viaProxyImplementation}
                chainId={chainId}
                label={t.decoder.implementationAddress}
              />
              <CopyButton
                value={data.verifiedCall.viaProxyImplementation}
                label={t.decoder.implementationAddress}
              />
            </div>
          </div>
        )}

        {data.params.length > 0 && (
          <table className="table table-sm block sm:table">
            <thead className="hidden sm:table-header-group">
              <tr>
                <th>{t.decoder.parameter}</th>
                <th>{t.decoder.type}</th>
                <th>{t.decoder.value}</th>
              </tr>
            </thead>
            <tbody className="block space-y-3 sm:table-row-group sm:space-y-0">
              {data.params.map((param, index) => (
                <ParamRow
                  key={`${data.raw}:${param.name ?? 'arg'}-${index}`}
                  param={param}
                  index={index}
                  chainId={chainId}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  /* 树身份 = 链 + 目标 + calldata：切换缓存结果时强制重建组件，
     让默认展开状态（高风险 / 未知路径）对新树重新计算 */
  const callTree = (
    <CallTreeView
      key={`${chainId}:${data.to ?? ''}:${data.raw}:${data.signatureSource}`}
      tree={tree}
      chainId={chainId}
    />
  );

  const isNested = tree.nodeCount > 1;

  return (
    <div className="space-y-4">
      {data.explainKey && (
        <div className={`alert ${dangerStyle}`} role="status">
          <div className="text-sm">
            {data.danger === 'high' && (
              <span className="mr-1 font-bold">{t.decoder.highRisk}</span>
            )}
            {data.danger === 'medium' && (
              <span className="mr-1 font-bold">{t.decoder.caution}</span>
            )}
            {t.decoder.knownExplains[data.explainKey]}
            {explainArticleHref(data.explainKey) && (
              <Link
                href={explainArticleHref(data.explainKey)!}
                className="link ml-2 font-medium"
              >
                {t.common.whyRisky} →
              </Link>
            )}
          </div>
        </div>
      )}

      {isNested ? (
        <>
          {callTree}
          {functionCard}
        </>
      ) : (
        <>
          {functionCard}
          {callTree}
        </>
      )}

      <details className="collapse-arrow collapse border border-base-300 bg-base-200">
        <summary className="collapse-title text-sm text-base-content/75">
          {t.decoder.rawCalldata}
        </summary>
        <div className="collapse-content">
          <div className="mb-2 flex justify-end">
            <CopyButton value={data.raw} label={t.decoder.rawCalldata} />
          </div>
          <code className="block break-all font-mono text-xs text-base-content/75">
            {data.raw}
          </code>
        </div>
      </details>
    </div>
  );
}

function ParamRow({
  param,
  index,
  chainId,
}: {
  param: DecodedParam;
  index: number;
  chainId: number;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const label =
    param.isAddress && isAddress(param.value)
      ? getSpenderLabel(getAddress(param.value), chainId)
      : undefined;
  const isMaxUint = !param.isTokenId && isMaxUintValue(param.type, param.value);
  const scope = param.approvalAmountScope;
  const amountLabel = scope === 'max' || scope === 'large' ? t.approvalScope[scope] : undefined;
  const isLongPlain =
    !param.isAddress &&
    !amountLabel &&
    !isMaxUint &&
    param.value.length > LONG_VALUE_THRESHOLD;

  return (
    <tr className="block rounded-box border border-base-300 p-3 sm:table-row sm:border-0 sm:p-0">
      <td className="block font-mono text-xs sm:table-cell">
        <span className="mr-2 text-base-content/70 sm:hidden">
          {t.decoder.parameter}:
        </span>
        {param.name || `arg${index}`}
      </td>
      <td className="block font-mono text-xs text-base-content/70 sm:table-cell">
        <span className="mr-2 sm:hidden">{t.decoder.type}:</span>
        {param.type}
      </td>
      <td className="block pt-2 sm:table-cell sm:pt-0">
        <span className="mr-2 text-xs text-base-content/70 sm:hidden">
          {t.decoder.value}:
        </span>
        {param.isAddress && isAddress(param.value) ? (
          <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
            {label && (
              <span className="badge badge-success badge-sm">{label.name}</span>
            )}
            <AddressLink address={param.value} chainId={chainId} />
            <CopyButton value={param.value} />
          </span>
        ) : amountLabel ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge badge-sm ${scope === 'max' ? 'badge-error' : 'badge-warning'}`}>
              {param.ambiguousApprovalAmount ? t.decoder.ifErc20(amountLabel) : amountLabel}
            </span>
            <span className="break-all font-mono text-xs tabular-nums">{param.value}</span>
          </div>
        ) : isMaxUint ? (
          <span className="badge badge-error badge-sm">
            {t.decoder.maxUintValue(param.type)}
          </span>
        ) : isLongPlain ? (
          <div className="space-y-1.5">
            <div className="break-all font-mono text-xs text-base-content/85">
              {param.isTokenId && <span className="mr-2 text-base-content/70">Token ID</span>}
              {expanded ? param.value : `${param.value.slice(0, LONG_VALUE_PREVIEW)}…`}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-base-content/55 tabular-nums">
                {t.decoder.valueLength(param.value.length)}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-xs h-6 min-h-0 border border-base-300 px-2"
                onClick={() => setExpanded((prev) => !prev)}
              >
                {expanded ? t.decoder.collapseValue : t.decoder.expandValue}
              </button>
              <CopyButton value={param.value} />
            </div>
          </div>
        ) : (
          <span className="break-all font-mono text-xs tabular-nums">
            {param.isTokenId && <span className="mr-2 text-base-content/70">Token ID</span>}
            {param.value}
          </span>
        )}
      </td>
    </tr>
  );
}

function explainArticleHref(key: DecodedResult['explainKey']): string | undefined {
  switch (key) {
    case 'permit':
      return '/articles/permit2-eip712-phishing';
    case 'approve':
    case 'approveZeroAmbiguous':
    case 'erc20Approval':
    case 'approvalForAll':
    case 'nftTokenApproval':
      return '/articles/why-unlimited-approval-is-dangerous';
    default:
      return undefined;
  }
}

function AddressLink({ address, chainId, label }: { address: string; chainId: number; label?: string }) {
  const { t } = useI18n();
  return (
    <a
      href={explorerAddressUrl(chainId, address)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label ?? t.decoder.targetContract}: ${address}`}
      className="link link-hover rounded-sm break-all font-mono text-xs text-base-content/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      {address}
    </a>
  );
}
