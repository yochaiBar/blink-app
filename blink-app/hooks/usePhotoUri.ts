import { useQuery } from '@tanstack/react-query';
import { getLocalPhotoUri } from '@/services/photoStore';
import { demoSource, isDemoResponse } from '@/services/demoSource';

/**
 * Local file URI of a response's photo, or null while it hasn't arrived.
 *
 * Photos never come from the server: the sender's device relays them (E2E)
 * and they land in the local photo store. useSocket invalidates
 * ['localPhoto', responseId] when one is decrypted, so this re-reads and the
 * image swaps in. Demo responses are served by demoSource.
 */
export function usePhotoUri(responseId: string | null | undefined): string | null {
  const query = useQuery({
    queryKey: ['localPhoto', responseId],
    queryFn: () => resolvePhotoUri(responseId),
    enabled: !!responseId,
    staleTime: 30_000,
  });
  return query.data ?? null;
}

/** One-off lookup of a response's local photo (same sources as usePhotoUri). */
export async function resolvePhotoUri(responseId: string | null | undefined): Promise<string | null> {
  if (!responseId) return null;
  if (isDemoResponse(responseId)) return demoSource.photoUri(responseId);
  return getLocalPhotoUri(responseId);
}
