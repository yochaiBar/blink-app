/**
 * renderHook for hooks that need React Query: renders the hook inside a
 * QueryClientProvider with react-test-renderer (no native views needed).
 */
import React, { act } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { create } = TestRenderer;

export function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

export async function renderHook<T>(hook: () => T, queryClient: QueryClient = newQueryClient()) {
  const result = { current: undefined as T };
  function Probe() {
    result.current = hook();
    return null;
  }
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  );
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(tree());
  });
  return {
    result,
    queryClient,
    /** Re-render (e.g. after changing mocked store state) and flush effects. */
    rerender: () =>
      act(async () => {
        renderer.update(tree());
      }),
    unmount: () =>
      act(async () => {
        renderer.unmount();
      }),
  };
}

/** Let pending promises (query fetches, effects' async work) settle. */
export const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
