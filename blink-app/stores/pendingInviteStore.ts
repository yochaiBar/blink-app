import { create } from 'zustand';

/**
 * An invite link the app was opened with (app/+native-intent.tsx), waiting
 * until the user is signed in and past onboarding — AuthGate then opens the
 * join screen with it, so a link tapped before login isn't lost.
 */
interface PendingInviteState {
  code: string | null;
  setCode: (code: string) => void;
  clear: () => void;
}

export const usePendingInvite = create<PendingInviteState>((set) => ({
  code: null,
  setCode: (code) => set({ code }),
  clear: () => set({ code: null }),
}));
