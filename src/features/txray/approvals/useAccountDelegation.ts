'use client';

import { useQuery } from '@tanstack/react-query';
import { type Address } from 'viem';
import { usePublicClient } from 'wagmi';
import { parseAccountCode, type AccountCodeInspection } from './eip7702';

export function useAccountDelegation(address: Address | undefined, chainId = 1) {
  const client = usePublicClient({ chainId });

  return useQuery<AccountCodeInspection>({
    queryKey: ['account-delegation', chainId, address?.toLowerCase()],
    enabled: Boolean(address && client),
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      if (!client || !address) return { status: 'unavailable' };
      try {
        const code = await client.getCode({ address });
        return parseAccountCode(code);
      } catch {
        return { status: 'unavailable' };
      }
    },
  });
}
