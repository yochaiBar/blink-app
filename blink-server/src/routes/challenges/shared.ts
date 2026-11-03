// Re-export processSkipsForChallenge from its new home in the service layer
// so existing imports (e.g. queries.ts) continue to work.
export { processSkipsForChallenge } from '../../services/streakService';

// Columns every challenge payload returns to the client.
export const CHALLENGE_SELECT = `
  id, group_id, prompt, created_by, created_at, expires_at, status
`;

// Same columns, qualified with the `c` alias for queries that join.
export const CHALLENGE_SELECT_C = `
  c.id, c.group_id, c.prompt, c.created_by, c.created_at, c.expires_at, c.status
`;
