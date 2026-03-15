/**
 * UI Component Smoke Tests - blink-app
 *
 * Smoke tests for core UI components from components/ui/:
 * - Button: renders with title, handles variants, shows loading state
 * - EmptyState: renders emoji, title, subtitle, optional action
 * - ErrorState: renders error message, optional retry
 * - StatusDot: renders with default and custom props
 *
 * These tests verify components mount and render key elements without crashing.
 */

import './component-setup';
import React from 'react';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';

// ── Import components under test ─────────────────────────────────
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import StatusDot from '@/components/ui/StatusDot';

// Suppress React's act() environment warning and deprecation notices
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});
afterAll(() => {
  console.error = originalConsoleError;
});

// Helper to create a renderer inside act() -- required for React 19
function createWithAct(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(element);
  });
  return tree;
}

// ── Button Tests ─────────────────────────────────────────────────

describe('Button', () => {
  const noop = jest.fn();

  it('renders without crashing', () => {
    const tree = createWithAct(
      React.createElement(Button, { title: 'Click me', onPress: noop }),
    );
    expect(tree.toJSON()).toBeTruthy();
  });

  it('displays the title text', () => {
    const tree = createWithAct(
      React.createElement(Button, { title: 'Submit', onPress: noop }),
    );
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('Submit');
  });

  it('renders with different variants without crashing', () => {
    const variants = ['primary', 'secondary', 'ghost', 'destructive'] as const;
    for (const variant of variants) {
      const tree = createWithAct(
        React.createElement(Button, { title: `Btn ${variant}`, onPress: noop, variant }),
      );
      expect(tree.toJSON()).toBeTruthy();
    }
  });

  it('renders with different sizes without crashing', () => {
    const sizes = ['sm', 'md', 'lg'] as const;
    for (const size of sizes) {
      const tree = createWithAct(
        React.createElement(Button, { title: `Btn ${size}`, onPress: noop, size }),
      );
      expect(tree.toJSON()).toBeTruthy();
    }
  });

  it('renders loading state without showing title', () => {
    const tree = createWithAct(
      React.createElement(Button, { title: 'Loading', onPress: noop, loading: true }),
    );
    const output = JSON.stringify(tree.toJSON());
    // When loading, the title text should NOT appear; ActivityIndicator shown instead
    expect(output).not.toContain('"Loading"');
    expect(output).toContain('ActivityIndicator');
  });

  it('renders disabled state', () => {
    const tree = createWithAct(
      React.createElement(Button, { title: 'Disabled', onPress: noop, disabled: true }),
    );
    expect(tree.toJSON()).toBeTruthy();
  });

  it('renders fullWidth variant', () => {
    const tree = createWithAct(
      React.createElement(Button, { title: 'Full', onPress: noop, fullWidth: true }),
    );
    expect(tree.toJSON()).toBeTruthy();
  });

  it('generates correct testID from title', () => {
    const tree = createWithAct(
      React.createElement(Button, { title: 'Save Changes', onPress: noop }),
    );
    const root = tree.root;
    const touchables = root.findAllByType('TouchableOpacity' as any);
    expect(touchables.length).toBeGreaterThan(0);
    expect(touchables[0].props.testID).toBe('button-save-changes');
  });
});

// ── EmptyState Tests ─────────────────────────────────────────────

describe('EmptyState', () => {
  it('renders without crashing', () => {
    const tree = createWithAct(
      React.createElement(EmptyState, {
        emoji: '📸',
        title: 'No photos yet',
        subtitle: 'Take your first blink!',
      }),
    );
    expect(tree.toJSON()).toBeTruthy();
  });

  it('displays emoji, title, and subtitle', () => {
    const tree = createWithAct(
      React.createElement(EmptyState, {
        emoji: '🎉',
        title: 'All caught up',
        subtitle: 'No new updates',
      }),
    );
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('🎉');
    expect(output).toContain('All caught up');
    expect(output).toContain('No new updates');
  });

  it('renders action button when actionLabel and onAction are provided', () => {
    const onAction = jest.fn();
    const tree = createWithAct(
      React.createElement(EmptyState, {
        emoji: '👋',
        title: 'Welcome',
        subtitle: 'Get started',
        actionLabel: 'Create Group',
        onAction,
      }),
    );
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('Create Group');
  });

  it('does not render action button when only actionLabel is provided (no onAction)', () => {
    const tree = createWithAct(
      React.createElement(EmptyState, {
        emoji: '👋',
        title: 'Welcome',
        subtitle: 'Get started',
        actionLabel: 'Create Group',
      }),
    );
    const output = JSON.stringify(tree.toJSON());
    expect(output).not.toContain('Create Group');
  });
});

// ── ErrorState Tests ─────────────────────────────────────────────

describe('ErrorState', () => {
  it('renders without crashing with no props', () => {
    const tree = createWithAct(
      React.createElement(ErrorState),
    );
    expect(tree.toJSON()).toBeTruthy();
  });

  it('displays default error message', () => {
    const tree = createWithAct(
      React.createElement(ErrorState),
    );
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('Something went wrong');
    expect(output).toContain('Oops!');
  });

  it('displays custom error message', () => {
    const tree = createWithAct(
      React.createElement(ErrorState, { message: 'Network error occurred' }),
    );
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('Network error occurred');
  });

  it('renders retry button when onRetry is provided', () => {
    const onRetry = jest.fn();
    const tree = createWithAct(
      React.createElement(ErrorState, { onRetry }),
    );
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('Try Again');
  });

  it('does not render retry button when onRetry is not provided', () => {
    const tree = createWithAct(
      React.createElement(ErrorState),
    );
    const output = JSON.stringify(tree.toJSON());
    expect(output).not.toContain('Try Again');
  });

  it('renders compact variant', () => {
    const onRetry = jest.fn();
    const tree = createWithAct(
      React.createElement(ErrorState, { compact: true, onRetry }),
    );
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('Retry');
    expect(output).toContain('Something went wrong');
  });

  it('does not show "Oops!" in compact mode', () => {
    const tree = createWithAct(
      React.createElement(ErrorState, { compact: true }),
    );
    const output = JSON.stringify(tree.toJSON());
    expect(output).not.toContain('Oops!');
  });
});

// ── StatusDot Tests ──────────────────────────────────────────────

describe('StatusDot', () => {
  it('renders without crashing with default props', () => {
    const tree = createWithAct(
      React.createElement(StatusDot),
    );
    expect(tree.toJSON()).toBeTruthy();
  });

  it('renders with custom color and size', () => {
    const tree = createWithAct(
      React.createElement(StatusDot, { color: '#FF0000', size: 12 }),
    );
    const json = tree.toJSON() as any;
    expect(json).toBeTruthy();
  });

  it('renders with pulse prop without crashing', () => {
    const tree = createWithAct(
      React.createElement(StatusDot, { pulse: true }),
    );
    expect(tree.toJSON()).toBeTruthy();
  });
});
