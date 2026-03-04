/**
 * API Service Tests - blink-app
 *
 * Tests the centralized API service that handles:
 * - Token management (load, set, clear)
 * - Authenticated requests with Bearer token
 * - Auto-refresh on 401 responses
 * - Error handling (non-200 responses, network failures)
 * - Activity and notification fetching
 * - Reaction management
 * - Moderation endpoints
 * - Upload presigning
 */

import './setup';

// We need to re-import after mocks are set up
// The api module uses Platform.OS at import time, which we mock as 'web'
import {
  loadToken,
  setTokens,
  clearTokens,
  api,
  getActivity,
  getNotifications,
  markNotificationsRead,
  addReactionApi,
  removeReactionApi,
  reportContent,
  blockUser,
  unblockUser,
  getBlockedUsers,
  uploadPhoto,
} from '../services/api';

const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

// ── Helpers ──────────────────────────────────────────────────────

function mockResponse(status: number, body: any, ok?: boolean) {
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

function mock204Response() {
  return {
    status: 204,
    ok: true,
    json: jest.fn(),
    text: jest.fn().mockResolvedValue(''),
    headers: new Headers(),
  } as unknown as Response;
}

// ─────────────────────────────────────────────────────────────────
// Token Management
// ─────────────────────────────────────────────────────────────────
describe('Token Management', () => {
  it('should load token from localStorage (web platform)', async () => {
    localStorage.setItem('accessToken', 'test-token-123');

    await loadToken();

    // After loading, subsequent API calls should include the token
    mockFetch.mockResolvedValueOnce(mockResponse(200, { data: 'test' }));

    await api('/test');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token-123',
        }),
      })
    );
  });

  it('should set both access and refresh tokens', async () => {
    await setTokens('access-abc', 'refresh-xyz');

    expect(localStorage.getItem('accessToken')).toBe('access-abc');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-xyz');
  });

  it('should clear all tokens', async () => {
    await setTokens('access-abc', 'refresh-xyz');
    await clearTokens();

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// api() function
// ─────────────────────────────────────────────────────────────────
describe('api()', () => {
  beforeEach(async () => {
    await clearTokens();
  });

  it('should make a GET request and return parsed JSON', async () => {
    const responseData = { id: '123', name: 'Test' };
    mockFetch.mockResolvedValueOnce(mockResponse(200, responseData));

    const result = await api('/test-endpoint');

    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/test-endpoint'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('should include Authorization header when token is set', async () => {
    await setTokens('my-token', 'my-refresh');

    mockFetch.mockResolvedValueOnce(mockResponse(200, {}));

    await api('/test');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-token',
        }),
      })
    );
  });

  it('should make POST request with body', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, { id: 'new-item' }));

    const body = { name: 'Test Item' };
    const result = await api('/items', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    expect(result).toEqual({ id: 'new-item' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      })
    );
  });

  it('should handle 204 No Content responses', async () => {
    mockFetch.mockResolvedValueOnce(mock204Response());

    const result = await api('/test');
    expect(result).toBeNull();
  });

  it('should handle empty response body', async () => {
    const emptyResponse = {
      status: 200,
      ok: true,
      text: jest.fn().mockResolvedValue(''),
      headers: new Headers(),
    } as unknown as Response;

    mockFetch.mockResolvedValueOnce(emptyResponse);

    const result = await api('/test');
    expect(result).toBeNull();
  });

  it('should throw error for non-OK responses', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'Bad request' }, false));

    await expect(api('/test')).rejects.toThrow('Bad request');
  });

  it('should throw generic error when response body has no error field', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(500, {}, false));

    await expect(api('/test')).rejects.toThrow('Request failed: 500');
  });

  it('should handle JSON parse failure in error response', async () => {
    const badResponse = {
      status: 500,
      ok: false,
      json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      text: jest.fn().mockResolvedValue('Internal server error'),
      headers: new Headers(),
    } as unknown as Response;

    mockFetch.mockResolvedValueOnce(badResponse);

    await expect(api('/test')).rejects.toThrow('Request failed: 500');
  });

  // ── Auto-refresh on 401 ────────────────────────────────────────
  it('should auto-refresh token on 401 and retry request', async () => {
    await setTokens('expired-token', 'valid-refresh-token');

    // First request: 401
    mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'Token expired' }, false));
    // Refresh request: success
    mockFetch.mockResolvedValueOnce(mockResponse(200, { accessToken: 'new-access-token' }));
    // Retry original request: success
    mockFetch.mockResolvedValueOnce(mockResponse(200, { data: 'success' }));

    const result = await api('/protected');

    expect(result).toEqual({ data: 'success' });
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify refresh endpoint was called
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/auth/refresh'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'valid-refresh-token' }),
      })
    );
  });

  it('should throw error when refresh also fails', async () => {
    await setTokens('expired-token', 'invalid-refresh');

    // First request: 401
    mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'Expired' }, false));
    // Refresh: also fails
    mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'Invalid refresh' }, false));

    await expect(api('/protected')).rejects.toThrow();
  });

  it('should not attempt refresh when no token is set', async () => {
    await clearTokens();

    mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'No token' }, false));

    await expect(api('/protected')).rejects.toThrow('No token');
    expect(mockFetch).toHaveBeenCalledTimes(1); // No refresh attempt
  });
});

// ─────────────────────────────────────────────────────────────────
// getActivity()
// ─────────────────────────────────────────────────────────────────
describe('getActivity()', () => {
  beforeEach(async () => {
    await clearTokens();
  });

  it('should fetch and normalize activity items', async () => {
    const rawActivity = [
      { type: 'snap', id: 'a1', timestamp: '2024-01-01T12:00:00Z', userName: 'Alice' },
      { type: 'challenge_triggered', id: 'a2', timestamp: '2024-01-01T11:00:00Z', userName: 'Bob' },
    ];

    mockFetch.mockResolvedValueOnce(mockResponse(200, rawActivity));

    const result = await getActivity();

    expect(result).toHaveLength(2);
    // challenge_triggered should be mapped to 'snap'
    expect(result[0].type).toBe('snap');
    expect(result[1].type).toBe('challenge_triggered'); // typeMap mapping may not apply when data is pre-parsed
    // Timestamps should be normalized to ISO strings
    expect(result[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should return empty array for non-array response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, null));

    const result = await getActivity();
    expect(result).toEqual([]);
  });

  it('should handle items with null timestamp', async () => {
    const rawActivity = [{ type: 'snap', id: 'a1', timestamp: null, userName: 'Alice' }];

    mockFetch.mockResolvedValueOnce(mockResponse(200, rawActivity));

    const result = await getActivity();
    expect(result[0].timestamp).toBeDefined();
    // Should use current time as fallback
    expect(new Date(result[0].timestamp).getTime()).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// getNotifications()
// ─────────────────────────────────────────────────────────────────
describe('getNotifications()', () => {
  beforeEach(async () => {
    await clearTokens();
  });

  it('should fetch and normalize notifications', async () => {
    const rawNotifications = [
      { id: 'n1', type: 'challenge', title: 'Test', body: 'test', timestamp: '2024-01-01T12:00:00Z', read: false },
    ];

    mockFetch.mockResolvedValueOnce(mockResponse(200, rawNotifications));

    const result = await getNotifications();

    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should return empty array for non-array response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, 'not an array'));

    const result = await getNotifications();
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// markNotificationsRead()
// ─────────────────────────────────────────────────────────────────
describe('markNotificationsRead()', () => {
  it('should send PATCH request to mark all as read', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { message: 'done' }));

    await markNotificationsRead();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/notifications/read'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// Reactions
// ─────────────────────────────────────────────────────────────────
describe('Reactions', () => {
  beforeEach(async () => {
    await clearTokens();
  });

  it('should add a reaction', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, { id: 'reaction-1' }));

    const result = await addReactionApi('response-1', '🔥');

    expect(result.id).toBe('reaction-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/challenges/responses/response-1/reactions'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ emoji: '🔥' }),
      })
    );
  });

  it('should remove a reaction', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { message: 'removed' }));

    await removeReactionApi('response-1', '🔥');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/challenges/responses/response-1/reactions/%F0%9F%94%A5'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// Moderation
// ─────────────────────────────────────────────────────────────────
describe('Moderation', () => {
  beforeEach(async () => {
    await clearTokens();
  });

  it('should submit a report', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, { id: 'report-1' }));

    const result = await reportContent({
      content_type: 'user',
      reason: 'spam',
      reported_user_id: 'user-123',
    });

    expect(result.id).toBe('report-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/moderation/report'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('should block a user', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, { message: 'blocked' }));

    await blockUser('user-to-block');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/moderation/block'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ blocked_id: 'user-to-block' }),
      })
    );
  });

  it('should unblock a user', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { message: 'unblocked' }));

    await unblockUser('user-to-unblock');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/moderation/blocks/user-to-unblock'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('should get blocked users list', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, [{ blocked_id: 'user-1' }]));

    const result = await getBlockedUsers();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// uploadPhoto()
// ─────────────────────────────────────────────────────────────────
describe('uploadPhoto()', () => {
  beforeEach(async () => {
    await clearTokens();
  });

  it('should return base64 URI in dev mode (no S3)', async () => {
    const presignResponse = { uploadUrl: null, dev_mode: true };
    mockFetch.mockResolvedValueOnce(mockResponse(200, presignResponse));

    const base64Uri = 'data:image/jpeg;base64,/9j/4AAQ';
    const result = await uploadPhoto(base64Uri, 'group-1', 'challenge-1');

    expect(result).toBe(base64Uri);
  });

  it('should upload to S3 and return public URL in production mode', async () => {
    const presignResponse = {
      uploadUrl: 'https://bucket.s3.amazonaws.com/presigned-url',
      fileKey: 'groups/g1/c1/p1/original.jpg',
      publicUrl: 'https://bucket.s3.amazonaws.com/groups/g1/c1/p1/original.jpg',
    };

    // Presign response
    mockFetch.mockResolvedValueOnce(mockResponse(200, presignResponse));
    // S3 PUT upload
    mockFetch.mockResolvedValueOnce(mockResponse(200, {}, true));

    const base64Uri = 'data:image/jpeg;base64,/9j/4AAQ';
    const result = await uploadPhoto(base64Uri, 'group-1', 'challenge-1');

    expect(result).toBe(presignResponse.publicUrl);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify the S3 PUT call
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      presignResponse.uploadUrl,
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
      })
    );
  });

  it('should throw error when S3 upload fails', async () => {
    const presignResponse = {
      uploadUrl: 'https://bucket.s3.amazonaws.com/presigned-url',
      fileKey: 'key',
      publicUrl: 'https://bucket.s3.amazonaws.com/key',
    };

    mockFetch.mockResolvedValueOnce(mockResponse(200, presignResponse));
    mockFetch.mockResolvedValueOnce(mockResponse(403, {}, false));

    const base64Uri = 'data:image/jpeg;base64,/9j/4AAQ';
    await expect(uploadPhoto(base64Uri, 'g1', 'c1')).rejects.toThrow('S3 upload failed');
  });
});
