import { useState, useEffect, useRef } from 'react';
import type { EncryptionMetadata } from '@/types/api';
import {
  getGroupKey,
  decryptPhotoBlob,
  getCachedPhotoUri,
  cacheDecryptedPhoto,
} from '@/services/encryption';

interface UseDecryptedPhotoResult {
  uri: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook that transparently handles encrypted vs unencrypted photos.
 *
 * - If `encryptionMetadata` is absent/null, returns `photoUrl` as-is (backward compat).
 * - Otherwise: checks disk cache -> fetches encrypted blob -> decrypts -> caches -> returns local URI.
 * - On any decryption error, falls back to the raw `photoUrl`.
 */
export function useDecryptedPhoto(
  photoUrl: string | null | undefined,
  encryptionMetadata: EncryptionMetadata | null | undefined,
  groupId: string | undefined,
  responseId: string | undefined,
): UseDecryptedPhotoResult {
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the current request to avoid stale updates
  const requestRef = useRef(0);

  useEffect(() => {
    // No encryption -- pass through
    if (!encryptionMetadata || !groupId || !responseId) {
      setUri(photoUrl ?? null);
      setLoading(false);
      setError(null);
      return;
    }

    if (!photoUrl) {
      setUri(null);
      setLoading(false);
      return;
    }

    const requestId = ++requestRef.current;

    async function decrypt() {
      setLoading(true);
      setError(null);

      try {
        // 1. Check disk cache
        const cached = await getCachedPhotoUri(responseId!);
        if (cached) {
          if (requestRef.current === requestId) {
            setUri(cached);
            setLoading(false);
          }
          return;
        }

        // 2. Fetch the encrypted blob
        const response = await fetch(photoUrl!);
        if (!response.ok) {
          throw new Error(`Failed to fetch encrypted photo: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const encryptedData = new Uint8Array(arrayBuffer);

        // 3. Get group key and decrypt
        const groupKey = await getGroupKey(groupId!);
        const jpegBytes = decryptPhotoBlob(encryptedData, encryptionMetadata!, groupKey);

        // 4. Cache to disk
        const localUri = await cacheDecryptedPhoto(responseId!, jpegBytes);

        if (requestRef.current === requestId) {
          setUri(localUri);
          setLoading(false);
        }
      } catch (err) {
        if (requestRef.current === requestId) {
          const msg = err instanceof Error ? err.message : 'Decryption failed';
          setError(msg);
          // Fall back to raw URL
          setUri(photoUrl ?? null);
          setLoading(false);
        }
      }
    }

    decrypt();
  }, [photoUrl, encryptionMetadata, groupId, responseId]);

  return { uri, loading, error };
}
