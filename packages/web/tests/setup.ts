/**
 * jsdom shims for the browser APIs the app legitimately uses.
 * Anything missing here must degrade gracefully in the app itself.
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// The visual engine probes these; jsdom has no layout engine.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

// Canvas is intentionally unimplemented: every chart must survive without it.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

Object.defineProperty(window, 'requestAnimationFrame', {
  writable: true,
  value: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16) as unknown as number,
});
Object.defineProperty(window, 'cancelAnimationFrame', { writable: true, value: (id: number) => clearTimeout(id) });

// EventSource is replaced per-test when a stream is needed.
class EventSourceStub {
  static instances: EventSourceStub[] = [];
  listeners: Record<string, Array<(event: MessageEvent) => void>> = {};
  constructor(readonly url: string) {
    EventSourceStub.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  emit(type: string, data: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener({ data: JSON.stringify(data) } as MessageEvent);
  }
  close(): void {}
}
(globalThis as unknown as { EventSource: unknown }).EventSource = EventSourceStub;
export { EventSourceStub };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
