declare module 'react-test-renderer' {
  import React from 'react';

  interface ReactTestRendererJSON {
    type: string;
    props: Record<string, unknown>;
    children: (ReactTestRendererJSON | string)[] | null;
  }

  interface ReactTestRenderer {
    toJSON(): ReactTestRendererJSON | null;
    unmount(): void;
    update(element: React.ReactElement): void;
    root: ReactTestInstance;
  }

  interface ReactTestInstance {
    findByType(type: React.ComponentType): ReactTestInstance;
    findByProps(props: Record<string, unknown>): ReactTestInstance;
    findAllByType(type: React.ComponentType): ReactTestInstance[];
    findAllByProps(props: Record<string, unknown>): ReactTestInstance[];
    props: Record<string, unknown>;
    type: string | React.ComponentType;
    children: (ReactTestInstance | string)[];
  }

  function create(element: React.ReactElement): ReactTestRenderer;
  function act(callback: () => void | Promise<void>): void;

  export { ReactTestRenderer, ReactTestRendererJSON, ReactTestInstance, act };
  export default { create };
}
