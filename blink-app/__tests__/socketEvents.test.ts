/**
 * socketEvents — every socket listener, attached once per socket: cache
 * invalidation, screen subscriptions, and hand-off to the photo / key flows.
 */

import './setup';

import type { QueryClient } from '@tanstack/react-query';
import { attachSocketEvents, subscribe, type ChallengeFinalizedEvent } from '../services/socketEvents';

const mockReceivePhoto = jest.fn();
const mockRespondToPickup = jest.fn();
const mockRespondToKeyshareRequest = jest.fn();
const mockAcceptKeyshareEnvelope = jest.fn();
const mockRetryPendingRelays = jest.fn();
const mockPlayChallengeRing = jest.fn();
jest.mock('@/services/photoTransfer', () => ({
  receivePhoto: (...a: unknown[]) => mockReceivePhoto(...a),
  respondToPickup: (...a: unknown[]) => mockRespondToPickup(...a),
}));
jest.mock('@/services/keyTransfer', () => ({
  respondToKeyshareRequest: (...a: unknown[]) => mockRespondToKeyshareRequest(...a),
  acceptKeyshareEnvelope: (...a: unknown[]) => mockAcceptKeyshareEnvelope(...a),
}));
jest.mock('@/services/relayRetry', () => ({ retryPendingRelays: () => mockRetryPendingRelays() }));
jest.mock('@/utils/challengeSound', () => ({ playChallengeRing: () => mockPlayChallengeRing() }));
jest.mock('@/services/api', () => ({ requestKeyshare: jest.fn() }));
jest.mock('@/services/groupCrypto', () => ({ getOrCreateDeviceKey: jest.fn(), loadGroupKeyVersion: jest.fn() }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: 'me' } }) } }));

/** A socket stand-in that records listeners and lets the test fire events. */
function fakeSocket() {
  const listeners = new Map<string, ((...args: unknown[]) => unknown)[]>();
  return {
    on(event: string, listener: (...args: never[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener as (...args: unknown[]) => unknown]);
    },
    async fire(event: string, ...args: unknown[]) {
      await Promise.all((listeners.get(event) ?? []).map((l) => l(...args)));
    },
    count: (event: string) => listeners.get(event)?.length ?? 0,
  };
}

function fakeQueryClient() {
  const invalidateQueries = jest.fn();
  return {
    client: { invalidateQueries } as unknown as QueryClient,
    invalidated: () => invalidateQueries.mock.calls.map((c) => c[0].queryKey),
  };
}

const finalized: ChallengeFinalizedEvent = {
  challengeId: 'c1',
  groupId: 'g1',
  status: 'completed',
  groupStreak: 3,
  brokenBy: null,
  milestones: [{ userId: 'u2', displayName: 'Dana', streak: 7 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRetryPendingRelays.mockResolvedValue(0);
  mockPlayChallengeRing.mockResolvedValue(undefined);
});

describe('socketEvents', () => {
  it('attaches once per socket', () => {
    const socket = fakeSocket();
    const { client } = fakeQueryClient();

    attachSocketEvents(socket, client);
    attachSocketEvents(socket, client);

    expect(socket.count('challenge:finalized')).toBe(1);
    expect(socket.count('photo:incoming')).toBe(1);
  });

  it('a finalized challenge refreshes its queries and reaches subscribers until they leave', async () => {
    const socket = fakeSocket();
    const queries = fakeQueryClient();
    attachSocketEvents(socket, queries.client);
    const seen: ChallengeFinalizedEvent[] = [];
    const leave = subscribe('challenge:finalized', (e) => seen.push(e));

    await socket.fire('challenge:finalized', finalized);
    leave();
    await socket.fire('challenge:finalized', finalized);

    expect(seen).toEqual([finalized]);
    expect(queries.invalidated()).toEqual(
      expect.arrayContaining([['challenge', 'g1'], ['responses', 'c1'], ['groups'], ['blinks-feed-v2']]),
    );
  });

  it('rings for a challenge someone else started, not for our own', async () => {
    const socket = fakeSocket();
    attachSocketEvents(socket, fakeQueryClient().client);

    await socket.fire('challenge:started', { id: 'c1', group_id: 'g1', created_by: 'me' });
    expect(mockPlayChallengeRing).not.toHaveBeenCalled();
    await socket.fire('challenge:started', { id: 'c2', group_id: 'g1', created_by: 'u2' });
    expect(mockPlayChallengeRing).toHaveBeenCalledTimes(1);
  });

  it('ACKs incoming photos with the decrypt outcome, and NACKs a handler crash', async () => {
    const socket = fakeSocket();
    attachSocketEvents(socket, fakeQueryClient().client);
    const ack = jest.fn();
    const envelope = { v: 2, response_id: 'r1', challenge_id: 'c1' };

    mockReceivePhoto.mockResolvedValueOnce({ v: 2, response_id: 'r1', ok: true });
    await socket.fire('photo:incoming', envelope, ack);
    mockReceivePhoto.mockRejectedValueOnce(new Error('boom'));
    await socket.fire('photo:incoming', envelope, ack);

    expect(ack.mock.calls).toEqual([[{ v: 2, response_id: 'r1', ok: true }], [{ ok: false, error: 'BAD_PAYLOAD' }]]);
  });

  it('hands keyshare events to keyTransfer and reacts to the outcome', async () => {
    const socket = fakeSocket();
    const queries = fakeQueryClient();
    attachSocketEvents(socket, queries.client);

    mockRespondToKeyshareRequest.mockResolvedValueOnce('key_changed');
    await socket.fire('group:keyshare_request', { group_id: 'g1' });
    mockAcceptKeyshareEnvelope.mockResolvedValueOnce('stored');
    await socket.fire('group:keyshare_envelope', { group_id: 'g1' });

    expect(mockAcceptKeyshareEnvelope).toHaveBeenCalledWith({ group_id: 'g1' }, 'me');
    expect(queries.invalidated()).toEqual(expect.arrayContaining([['deviceKeys', 'g1'], ['groups']]));
    // A key that arrived unblocks queued snaps.
    expect(mockRetryPendingRelays).toHaveBeenCalledTimes(1);
  });

  it('retries queued relays whenever the socket (re)connects', async () => {
    const socket = fakeSocket();
    attachSocketEvents(socket, fakeQueryClient().client);

    await socket.fire('connect');

    expect(mockRetryPendingRelays).toHaveBeenCalledTimes(1);
  });
});
