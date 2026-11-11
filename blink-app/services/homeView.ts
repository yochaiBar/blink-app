/**
 * What the Home tab shows. A user without a real group gets the demo
 * challenge's card (from demoSource, so the screen never branches on the
 * demo) with a get-started empty state below it.
 */

import type { FeedItemData } from '@/components/FeedItem';
import { demoSource } from '@/services/demoSource';

/** new_user: no real group yet (get started); no_challenges: groups, but nothing to show yet. */
export type HomeEmptyState = 'new_user' | 'no_challenges';

export interface HomeViewInput {
  hasRealGroups: boolean;
  demoVisible: boolean;
  feedItems: FeedItemData[];
  isLoading: boolean;
}

export interface HomeView {
  items: FeedItemData[];
  emptyState: HomeEmptyState | null;
}

export function homeView(input: HomeViewInput): HomeView {
  if (!input.hasRealGroups) {
    return { items: input.demoVisible ? demoSource.homeItems() : [], emptyState: 'new_user' };
  }
  const nothingYet = !input.isLoading && input.feedItems.length === 0;
  return { items: input.feedItems, emptyState: nothingYet ? 'no_challenges' : null };
}
