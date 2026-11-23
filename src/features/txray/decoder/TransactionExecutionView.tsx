'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { formatUnits, type Address } from 'viem';
import { usePublicClient } from 'wagmi';
import { useI18n } from '@/lib/i18n/provider';
import { explorerAddressUrl, explorerTxUrl } from '../chains/chains';
import { readTransactionExecution, type ReceiptEvent } from './transactionExecution';
import type { DecoderTransaction } from './useDecoder';

const statusStyles = {
  loading: 'badge-ghost',
  pending: 'badge-warning',
  success: 'badge-success',
  reverted: 'badge-error',
  unknown: 'badge-warning',
  unavailable: 'badge-warning',
};

export function TransactionExecutionView({ transaction, chainId }: { transaction: DecoderTransaction; chainId: number }) {
  const { t } = useI18n();
  const copy = t.decoder.execution;
  const client = usePublicClient({ chainId });
  const query = useQuery({
    queryKey: ['transaction-execution', chainId, transaction.hash.toLowerCase(), transaction.blockNumber?.toString()],
    enabled: Boolean(client),
    staleTime: 60_000,
    retry: false,
    refetchInterval: (query) => query.state.data?.status === 'pending' && query.state.status !== 'error' ? 5_000 : false,
    queryFn: () => {
      if (!client) throw new Error('目标链 RPC 不可用');
      return readTransactionExecution(client, transaction);
    },
  });

  const status = query.isError || !client ? 'unavailable' : query.data?.status ?? 'loading';
  const receipt = !query.isError && query.data?.status !== 'pending' ? query.data : undefined;
  const block = receipt?.blockNumber ?? transaction.blockNumber;
  const target = transaction.to ?? receipt?.contractAddress;
  const currency = client?.chain?.nativeCurrency;

  return (
    <section aria-labelledby="transaction-execution-title" className="card mb-4 border border-base-300 bg-base-200">
      <div className="card-body gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="transaction-execution-title" className="text-lg font-semibold">{copy.title}</h2>
            <span className={`badge ${statusStyles[status]}`} role="status">{copy.statuses[status]}</span>
          </div>
          <a className="link link-primary text-sm" href={explorerTxUrl(chainId, transaction.hash)}
            target="_blank" rel="noopener noreferrer">{copy.explorerLink}</a>
        </div>

        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <ExecutionField label={copy.from}><ExecutionAddress chainId={chainId} address={transaction.from} /></ExecutionField>
          <ExecutionField label={transaction.to ? copy.to : copy.deployment}>
            {target ? <ExecutionAddress chainId={chainId} address={target} /> : copy.noDeploymentAddress}
          </ExecutionField>
          <ExecutionField label={copy.nativeValue}>
            {currency ? `${formatUnits(transaction.value, currency.decimals)} ${currency.symbol}` : `${transaction.value} wei`}
          </ExecutionField>
          {block !== null && <ExecutionField label={copy.block}>{block.toString()}</ExecutionField>}
        </dl>

        {(status === 'unavailable' || status === 'pending') && (
          <div>
            <button type="button" className="btn btn-outline btn-xs" disabled={!client || query.isFetching}
              onClick={() => void query.refetch()}>{copy.refresh}</button>
          </div>
        )}

        {receipt && (
          <details className="rounded-box border border-base-300 bg-base-100 p-3" open={receipt.events.length > 0}>
            <summary className="cursor-pointer text-sm font-medium">{copy.events(receipt.events.length)}</summary>
            {receipt.events.length === 0 ? (
              <p className="mt-2 text-xs text-base-content/70">{copy.noEvents}</p>
            ) : (
              <ul className="mt-2 divide-y divide-base-300">
                {receipt.events.map((event, index) => (
                  <ReceiptEventRow key={index} event={event} chainId={chainId} />
                ))}
              </ul>
            )}
            {receipt.unrecognizedLogs > 0 && <p className="mt-2 text-xs text-base-content/70">{copy.unrecognizedLogs(receipt.unrecognizedLogs)}</p>}
            {receipt.omittedLogs > 0 && <p className="mt-2 text-xs text-base-content/70">{copy.omittedLogs(receipt.omittedLogs)}</p>}
          </details>
        )}
      </div>
    </section>
  );
}

function ReceiptEventRow({ event, chainId }: { event: ReceiptEvent; chainId: number }) {
  const { t } = useI18n();
  const copy = t.decoder.execution;
  const transfer = event.kind === 'transfer';
  const collection = event.kind === 'approvalForAll';
  const name = collection
    ? (event.approved ? t.approvalScope.collection : copy.collectionRevoked)
    : copy.eventNames[event.kind];
  const recipientLabel = transfer ? copy.to : collection ? copy.operator : copy.approvedAddress;
  const amountLabel = transfer ? copy.rawAmount : copy.rawAllowance;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{name}</span>
        {!collection && <span className="badge badge-ghost badge-sm">{copy.formats[event.format]}</span>}
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <ExecutionField label={transfer ? copy.from : copy.owner}>
          <ExecutionAddress address={event.from} chainId={chainId} />
        </ExecutionField>
        <ExecutionField label={recipientLabel}><ExecutionAddress address={event.to} chainId={chainId} /></ExecutionField>
        <ExecutionField label={copy.emitter}><ExecutionAddress address={event.contract} chainId={chainId} /></ExecutionField>
        {!collection && (
          <ExecutionField label={event.format === 'erc721' ? 'Token ID' : amountLabel}>
            {event.value.toString()}
          </ExecutionField>
        )}
      </dl>
    </li>
  );
}

function ExecutionField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 text-xs">
      <dt className="text-base-content/70">{label}</dt>
      <dd className="break-all font-mono">{children}</dd>
    </div>
  );
}

function ExecutionAddress({ address, chainId }: { address: Address; chainId: number }) {
  return (
    <a className="link link-hover" href={explorerAddressUrl(chainId, address)} target="_blank" rel="noopener noreferrer">
      {address}
    </a>
  );
}
