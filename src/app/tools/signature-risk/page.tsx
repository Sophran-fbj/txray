'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CopyButton } from '@/components/CopyButton';
import { useI18n } from '@/lib/i18n/provider';
import {
  analyzeTypedData,
  type FieldFinding,
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

export default function SignaturePage() {
  const { t } = useI18n();
  const copy = t.signatureRisk;
  const [input, setInput] = useState('');
  const [result, setResult] = useState<
    | { status: 'idle' }
    | { status: 'ok'; data: SignatureAnalysis }
    | { status: 'error'; error: string }
  >({ status: 'idle' });

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
              </div>
            </div>
            <textarea
              id="typed-data-input"
              value={input}
              onChange={(e) => {
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
