'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import type { Abi, Address, Hash } from 'viem';
import type { Approval } from './useApprovals';
import { createRevokeCall, isApprovalCleared, simulateRevoke } from './revoke';

export interface VerifiedRevocation {
  owner: Address;
  chainId: number;
  hash: Hash;
  symbol: string;
}

interface SubmittedRevocation extends Omit<VerifiedRevocation, 'symbol'> {
  approval: Approval;
  blockNumber?: bigint;
}

type RevokeStatus = 'confirming' | 'verifying' | 'revoked' | 'still-active' |
  'unverified' | 'receipt-unavailable' | 'replaced' | 'reverted';

interface UseRevokeApprovalOptions {
  account?: Address;
  canRevoke: boolean;
  chainId: number;
  walletChainId?: number;
  onRevoked: (revocation: VerifiedRevocation) => void;
}

export function useRevokeApproval({
  account,
  canRevoke,
  chainId,
  walletChainId,
  onRevoked,
}: UseRevokeApprovalOptions) {
  const queryClient = useQueryClient();
  const publicClient = usePublicClient({ chainId });
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const {
    writeContractAsync,
    isPending: isAwaitingWallet,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();
  const [prepareError, setPrepareError] = useState<Error>();
  const [progress, setProgress] = useState<{ transaction: SubmittedRevocation; status: RevokeStatus }>();
  const inProgress = useRef(false);

  const checkRevocation = async (submission: SubmittedRevocation) => {
    if (!publicClient) return;
    let transaction = submission;
    let blockNumber = submission.blockNumber;
    if (blockNumber === undefined) {
      setProgress({ transaction, status: 'confirming' });
      let replaced = false;
      try {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: transaction.hash,
          onReplaced: ({ reason }) => { replaced = reason !== 'repriced'; },
        });
        blockNumber = receipt.blockNumber;
        transaction = { ...transaction, hash: receipt.transactionHash, blockNumber };
        if (replaced || receipt.status !== 'success') {
          setProgress({ transaction, status: replaced ? 'replaced' : 'reverted' });
          return;
        }
      } catch {
        setProgress({ transaction, status: 'receipt-unavailable' });
        return;
      }
    }

    setProgress({ transaction, status: 'verifying' });
    const { owner, approval, hash, chainId } = transaction;
    let cleared: boolean;
    try {
      cleared = await isApprovalCleared(publicClient, owner, approval, blockNumber);
    } catch {
      setProgress({ transaction, status: 'unverified' });
      return;
    }
    setProgress({ transaction, status: cleared ? 'revoked' : 'still-active' });
    if (cleared) {
      onRevoked({ owner, chainId, hash, symbol: approval.symbol });
      void queryClient.invalidateQueries({ queryKey: ['approvals', chainId, owner.toLowerCase()], exact: true });
    }
  };

  const revoke = async (approval: Approval) => {
    if (inProgress.current) return;
    resetWrite();
    setPrepareError(undefined);
    if (!canRevoke || !account || !publicClient) {
      setPrepareError(new Error('钱包或目标链 RPC 不可用'));
      return;
    }

    inProgress.current = true;
    setProgress(undefined);
    try {
      if (walletChainId !== chainId) await switchChainAsync({ chainId });
      const request = await simulateRevoke(publicClient, account, createRevokeCall(approval));
      const abi: Abi = request.abi;
      const hash = await writeContractAsync({ ...request, abi, chainId });
      await checkRevocation({ owner: account, chainId, hash, approval });
    } catch (error) {
      setPrepareError(error instanceof Error ? error : new Error('撤销交易准备失败'));
    } finally {
      inProgress.current = false;
    }
  };

  const retryCheck = async () => {
    if (inProgress.current || !progress) return;
    inProgress.current = true;
    try {
      await checkRevocation(progress.transaction);
    } finally {
      inProgress.current = false;
    }
  };

  const status = progress?.status;
  return {
    hash: progress?.transaction.hash,
    status,
    isSwitching,
    isAwaitingWallet,
    busy: isSwitching || isAwaitingWallet || status === 'confirming' || status === 'verifying',
    error: prepareError ?? writeError,
    revoke,
    retryCheck,
  };
}
