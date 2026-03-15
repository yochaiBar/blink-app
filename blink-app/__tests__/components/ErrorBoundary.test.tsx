/**
 * ErrorBoundary Component Tests - blink-app
 *
 * Smoke tests for the ErrorBoundary component:
 * - Renders children normally when no error occurs
 * - Displays error UI when a child component throws
 * - Renders custom fallback when provided
 * - Supports reset via "Try Again" button
 */

import './component-setup';
import React from 'react';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// ── Test helper: component that throws on demand ─────────────────
let shouldThrow = false;
function ThrowingChild() {
  if (shouldThrow) {
    throw new Error('Test explosion');
  }
  return React.createElement('Text', null, 'Child content');
}

// Suppress console.error from ErrorBoundary.componentDidCatch and
// React's act() environment warning during tests
const originalConsoleError = console.error;

beforeAll(() => {
  console.error = jest.fn();
});

afterAll(() => {
  console.error = originalConsoleError;
});

beforeEach(() => {
  shouldThrow = false;
});

// Helper to create a renderer inside act()
function createWithAct(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(element);
  });
  return tree;
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error occurs', () => {
    const tree = createWithAct(
      React.createElement(
        ErrorBoundary,
        null,
        React.createElement('Text', null, 'Hello World'),
      ),
    );

    const json = tree.toJSON();
    expect(json).toBeTruthy();
    const output = JSON.stringify(json);
    expect(output).toContain('Hello World');
  });

  it('displays error UI when a child throws', () => {
    shouldThrow = true;

    const tree = createWithAct(
      React.createElement(
        ErrorBoundary,
        null,
        React.createElement(ThrowingChild),
      ),
    );

    const json = tree.toJSON();
    const output = JSON.stringify(json);
    expect(output).toContain('Something went wrong');
    expect(output).toContain('Try Again');
  });

  it('shows error message in dev mode', () => {
    (global as any).__DEV__ = true;
    shouldThrow = true;

    const tree = createWithAct(
      React.createElement(
        ErrorBoundary,
        null,
        React.createElement(ThrowingChild),
      ),
    );

    const json = tree.toJSON();
    const output = JSON.stringify(json);
    expect(output).toContain('Test explosion');
  });

  it('renders custom fallback when provided', () => {
    shouldThrow = true;
    const fallback = React.createElement('Text', null, 'Custom fallback UI');

    const tree = createWithAct(
      React.createElement(
        ErrorBoundary,
        { fallback },
        React.createElement(ThrowingChild),
      ),
    );

    const json = tree.toJSON();
    const output = JSON.stringify(json);
    expect(output).toContain('Custom fallback UI');
    expect(output).not.toContain('Something went wrong');
  });

  it('resets error state when "Try Again" is pressed', () => {
    shouldThrow = true;

    const tree = createWithAct(
      React.createElement(
        ErrorBoundary,
        null,
        React.createElement(ThrowingChild),
      ),
    );

    // Verify error state
    let output = JSON.stringify(tree.toJSON());
    expect(output).toContain('Something went wrong');

    // Stop throwing so reset succeeds
    shouldThrow = false;

    // Find the TouchableOpacity with the onPress handler
    const root = tree.root;
    const touchables = root.findAllByType('TouchableOpacity' as any);
    expect(touchables.length).toBeGreaterThan(0);

    act(() => {
      touchables[0].props.onPress();
    });

    // After reset, children should render normally
    output = JSON.stringify(tree.toJSON());
    expect(output).toContain('Child content');
    expect(output).not.toContain('Something went wrong');
  });
});
