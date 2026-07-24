import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminNav from '@/components/AdminNav';

// Mock i18n
vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

vi.mock('@/lib/sidebar/provider', () => ({
  useSidebar: () => ({ collapsed: false, toggle: vi.fn() }),
  SidebarProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock next/link and next/navigation
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, className }: any) => (
    <a href={href} onClick={onClick} className={className} data-testid="nav-link">
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
}));

describe('AdminNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 3 }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders admin title and nav links', async () => {
    render(<AdminNav email="admin@test.com" />);

    await waitFor(() => {
      // admin.title appears both in mobile header and sidebar
      expect(screen.getAllByText('admin.title').length).toBeGreaterThan(0);
    });

    // Check some of the main links
    expect(screen.getByText('admin.nav.overview')).toBeInTheDocument();
    expect(screen.getByText('admin.nav.collector')).toBeInTheDocument();
    expect(screen.getByText('admin.nav.users')).toBeInTheDocument();
  });

  it('renders email in footer', async () => {
    render(<AdminNav email="admin@test.com" />);

    await waitFor(() => {
      expect(screen.getByText('admin@test.com')).toBeInTheDocument();
    });
  });

  it('polls unread counts on mount', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 5 }),
    });
    global.fetch = mockFetch;

    render(<AdminNav email="admin@test.com" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/support/unread');
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/errors/unread');
    });
  });

  it('shows unread badge when count > 0', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ count: 7 }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ count: 0 }) });

    global.fetch = mockFetch;

    render(<AdminNav email="admin@test.com" />);

    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });
  });

  it('expands database group when clicked', async () => {
    render(<AdminNav email="admin@test.com" />);

    await waitFor(() => {
      expect(screen.getByText('admin.nav.overview')).toBeInTheDocument();
    });

    // Find the database group button
    const dbButton = screen.getByText('admin.nav.database').closest('button');
    expect(dbButton).toBeInTheDocument();

    fireEvent.click(dbButton!);

    await waitFor(() => {
      expect(screen.getByText('admin.nav.system')).toBeInTheDocument();
      expect(screen.getByText('admin.nav.backup')).toBeInTheDocument();
    });
  });

  it('renders mobile menu toggle', async () => {
    render(<AdminNav email="admin@test.com" />);

    await waitFor(() => {
      expect(screen.getByLabelText('menu')).toBeInTheDocument();
    });
  });

  it('shows back to app link', async () => {
    render(<AdminNav email="admin@test.com" />);

    await waitFor(() => {
      // admin.backToApp appears both in sidebar and (potentially) mobile; use getAllByText
      expect(screen.getAllByText('admin.backToApp').length).toBeGreaterThan(0);
    });
  });
});