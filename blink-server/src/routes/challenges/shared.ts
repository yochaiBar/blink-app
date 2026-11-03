// Columns every challenge payload returns to the client.
export { CHALLENGE_SELECT } from '../../services/challengeLifecycle';

// Same columns, qualified with the `c` alias for queries that join.
export const CHALLENGE_SELECT_C = `c.id, c.group_id, c.prompt, c.created_by, c.created_at, c.expires_at, c.status`;
