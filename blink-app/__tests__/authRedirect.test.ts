/**
 * authRedirect — where AuthGate sends the user for a given session state.
 */

import './setup';

import { authRedirect } from '../utils/authRedirect';

const base = { isLoading: false, isAuthenticated: false, isOffline: false, inOnboarding: false, hasName: false };

describe('authRedirect', () => {
  it('never sends a user whose session is only unconfirmed (offline) to onboarding', () => {
    expect(authRedirect({ ...base, isOffline: true })).toBeNull();
  });

  it('sends a signed-out user to onboarding, and waits while loading', () => {
    expect(authRedirect(base)).toBe('/onboarding');
    expect(authRedirect({ ...base, isLoading: true })).toBeNull();
    expect(authRedirect({ ...base, inOnboarding: true })).toBeNull();
  });

  it('takes a signed-in user out of onboarding once they have a name', () => {
    const signedIn = { ...base, isAuthenticated: true, inOnboarding: true };
    expect(authRedirect({ ...signedIn, hasName: true })).toBe('/');
    expect(authRedirect(signedIn)).toBeNull(); // still on the name step
    expect(authRedirect({ ...signedIn, inOnboarding: false, hasName: true })).toBeNull();
  });
});
