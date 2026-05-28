import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

// Mock fetch for API calls
const mockFetch = vi.fn().mockImplementation((url: string) => {
  if (url.includes('/api/health')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'ok' }),
    });
  }
  if (url.includes('/api/maps-config')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ apiKey: 'mock-api-key' }),
    });
  }
  return Promise.resolve({
    ok: false,
    status: 404,
    json: () => Promise.resolve({ error: 'Not found' }),
  });
});

describe('App', () => {
  beforeEach(() => {
    global.fetch = mockFetch;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders without crashing', async () => {
    render(<App />);
    await waitFor(() => {
      expect(document.querySelector('.flex.h-screen')).toBeInTheDocument();
    });
  });

  it('renders the default dashboard view', async () => {
    render(<App />);
    await waitFor(() => {
      expect(document.querySelector('main')).toBeInTheDocument();
    });
  });

  it('has main layout structure', async () => {
    const { container } = render(<App />);
    await waitFor(() => {
      const mainElement = container.querySelector('main');
      expect(mainElement).toBeInTheDocument();
      expect(mainElement).toHaveClass('flex-1', 'overflow-x-hidden', 'overflow-y-auto');
    });
  });
});
