import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HauntedBrowser } from './HauntedBrowser';
import { isLikelyUrl, normalizeUrl, resolveAddress, hostOf, clampZoom, NEWTAB } from './ghost';
import { loadBookmarks, saveBookmarks } from './bookmarks';

vi.mock('../../lib/casper', () => ({
  sendCasperCommand: vi.fn(async () => ({
    success: true,
    taskId: null,
    response: 'Boo — I see the tab.',
    surface: 'control_center',
    provider: 'test',
    model: 'test',
  })),
}));

vi.mock('../../lib/authSession', () => ({
  authedFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({ embeddable: true, reason: '' }),
  })),
}));

vi.mock('../../lib/desktop', () => ({
  isDesktopApp: () => false,
  isHauntedWebview: () => false,
  getDesktopBridge: () => null,
}));

describe('haunted address helpers', () => {
  it('treats hostnames as URLs and everything else as search', () => {
    expect(isLikelyUrl('github.com')).toBe(true);
    expect(isLikelyUrl('https://example.com/path')).toBe(true);
    expect(isLikelyUrl('how do ghosts compile')).toBe(false);
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(resolveAddress('github.com')).toBe('https://github.com');
    expect(resolveAddress('  ')).toBe(NEWTAB);
    expect(resolveAddress('casper browser')).toContain('duckduckgo.com');
    expect(hostOf('https://www.wikipedia.org/wiki/Ghost')).toBe('wikipedia.org');
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(9)).toBe(3);
  });
});

describe('haunted bookmarks', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips bookmarks per user', () => {
    saveBookmarks('user-1', [{ id: 1, title: 'MDN', url: 'https://developer.mozilla.org' }]);
    expect(loadBookmarks('user-1')).toEqual([{ id: 1, title: 'MDN', url: 'https://developer.mozilla.org' }]);
    expect(loadBookmarks('user-2')).toEqual([]);
  });
});

describe('HauntedBrowser', () => {
  it('renders Casper chrome and opens a new tab', async () => {
    const user = userEvent.setup();
    render(
      <HauntedBrowser
        userId="user-1"
        onClose={() => {}}
        isExpanded={false}
        onToggleExpand={() => {}}
      />,
    );

    expect(screen.getByTestId('haunted-browser')).toBeInTheDocument();
    expect(screen.getAllByText('Haunted Browser').length).toBeGreaterThan(0);
    expect(screen.getByText(/Casper's agentic browser/i)).toBeInTheDocument();
    expect(screen.getByTestId('haunted-casper-input')).toBeInTheDocument();

    await user.click(screen.getByTestId('haunted-new-tab'));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('hides the Casper panel when toggled', async () => {
    const user = userEvent.setup();
    render(
      <HauntedBrowser
        userId="user-1"
        onClose={() => {}}
        isExpanded={false}
        onToggleExpand={() => {}}
      />,
    );

    await user.click(screen.getByTestId('haunted-toggle-casper'));
    expect(screen.queryByTestId('haunted-casper-input')).not.toBeInTheDocument();
  });
});
