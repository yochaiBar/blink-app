/**
 * homeView — what Home shows: feed items, the demo for users without a real
 * group, and which empty state (if any) goes below them.
 */

import './setup';

import { homeView } from '../services/homeView';
import { demoSource } from '../services/demoSource';

describe('homeView', () => {
  it('shows a new user the demo card, then the get-started empty state', () => {
    const view = homeView({ hasRealGroups: false, demoVisible: true, feedItems: [], isLoading: false });

    expect(view.items.map((i) => i.id)).toEqual(demoSource.homeItems().map((i) => i.id));
    expect(view.emptyState).toBe('new_user');
  });

  it('tells a member whose groups have no challenges yet that they will show up here', () => {
    const view = homeView({ hasRealGroups: true, demoVisible: false, feedItems: [], isLoading: false });

    expect(view.items).toEqual([]);
    expect(view.emptyState).toBe('no_challenges');
  });
});
