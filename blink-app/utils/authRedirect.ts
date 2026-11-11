export interface AuthGateState {
  isLoading: boolean;
  isAuthenticated: boolean;
  /** A stored session the server couldn't confirm yet: not signed out. */
  isOffline: boolean;
  inOnboarding: boolean;
  /** Signed-in user has finished the name step. */
  hasName: boolean;
}

/**
 * Where AuthGate should send the user, or null to stay. Only a real
 * sign-out leads to onboarding; an unconfirmed (offline) session stays put
 * and AuthGate shows a retry state instead.
 */
export function authRedirect(state: AuthGateState): '/onboarding' | '/' | null {
  if (state.isLoading || state.isOffline) return null;
  if (!state.isAuthenticated && !state.inOnboarding) return '/onboarding';
  if (state.isAuthenticated && state.inOnboarding && state.hasName) return '/';
  return null;
}
