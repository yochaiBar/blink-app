/**
 * relayRetry — photos whose relay failed after the response was recorded.
 */

import './setup';

import * as SecureStore from 'expo-secure-store';
import { clearRelayRetries, queueRelayRetry, retryPendingRelays } from '../services/relayRetry';

const mockSendPhoto = jest.fn();
const mockGetSenderPlaintext = jest.fn();
jest.mock('@/services/photoTransfer', () => ({ sendPhoto: (...a: unknown[]) => mockSendPhoto(...a) }));
jest.mock('@/services/photoStore', () => ({ getSenderPlaintext: (...a: unknown[]) => mockGetSenderPlaintext(...a) }));

const store = new Map<string, string>();
const job = (responseId: string) => ({ groupId: 'g1', challengeId: 'c1', responseId, senderUserId: 'me' });
const PHOTO = new Uint8Array([1, 2, 3]);

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => store.get(k) ?? null);
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
    store.set(k, v);
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k: string) => {
    store.delete(k);
  });
  mockGetSenderPlaintext.mockResolvedValue(PHOTO);
});

const queued = () =>
  JSON.parse(store.get('blink.relay.retry.v1') ?? '[]').map((j: { responseId: string }) => j.responseId);

describe('relayRetry', () => {
  it('sends queued photos; drops the sent and the hopeless, keeps the failed', async () => {
    await Promise.all([queueRelayRetry(job('sent')), queueRelayRetry(job('fails')), queueRelayRetry(job('gone'))]);
    mockGetSenderPlaintext.mockImplementation(async (id: string) => (id === 'gone' ? null : PHOTO));
    mockSendPhoto.mockImplementation(async (args: { responseId: string }) => {
      if (args.responseId === 'fails') throw new Error('offline');
      return { delivered: [], queued: [] };
    });

    expect(await retryPendingRelays()).toBe(1);

    expect(mockSendPhoto).toHaveBeenCalledWith({ ...job('sent'), plaintext: PHOTO, queuedAt: expect.any(Number) });
    expect(queued()).toEqual(['fails']);
  });

  it('keeps one job per response, and concurrent retries share one pass', async () => {
    await queueRelayRetry(job('r1'));
    await queueRelayRetry(job('r1'));
    expect(queued()).toEqual(['r1']);
    mockSendPhoto.mockResolvedValue({ delivered: [], queued: [] });

    await Promise.all([retryPendingRelays(), retryPendingRelays()]);

    expect(mockSendPhoto).toHaveBeenCalledTimes(1);
  });

  it('drops jobs older than 7 days, and clears on logout', async () => {
    store.set('blink.relay.retry.v1', JSON.stringify([{ ...job('old'), queuedAt: Date.now() - 8 * 24 * 3600 * 1000 }]));
    expect(await retryPendingRelays()).toBe(0);
    expect(mockSendPhoto).not.toHaveBeenCalled();

    await queueRelayRetry(job('r2'));
    await clearRelayRetries();
    expect(store.has('blink.relay.retry.v1')).toBe(false);
  });
});
