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
  // Нужен колокольчику (NotificationBell): у личного уведомления есть адрес, и
  // по клику он уводит туда через router.push.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('AdminNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 3, announcements: [] }),
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
    // Мок разбирает АДРЕС, а не полагается на порядок вызовов: колокольчик
    // рядом спрашивает свои эндпоинты, и цепочка mockResolvedValueOnce
    // разъезжалась от любого нового запроса — тест падал не потому, что бейдж
    // сломан, а потому что ответы доставались не тем.
    const mockFetch = vi.fn((url: string) => {
      const body =
        url === '/api/admin/support/unread'
          ? { count: 7 }
          : url === '/api/admin/errors/unread'
            ? { count: 0 }
            : url === '/api/announcements'
              ? { announcements: [] }
              : { notifications: [] };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    });

    global.fetch = mockFetch as unknown as typeof fetch;

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

  // Мобильное меню: открывается бургером, закрывается крестиком, кликом по
  // подложке и переходом по ссылке.
  describe('mobile drawer', () => {
    it('opens on the burger and closes on the X', async () => {
      render(<AdminNav email="admin@test.com" />);
      expect(screen.queryByLabelText('close menu')).not.toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('menu'));
      expect(screen.getByLabelText('close menu')).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('close menu'));
      await waitFor(() =>
        expect(screen.queryByLabelText('close menu')).not.toBeInTheDocument(),
      );
    });

    it('closes when the backdrop is clicked', async () => {
      const { container } = render(<AdminNav email="admin@test.com" />);
      fireEvent.click(screen.getByLabelText('menu'));

      const backdrop = container.querySelector('.bg-black\\/50') as HTMLElement;
      expect(backdrop).toBeTruthy();
      fireEvent.click(backdrop);
      await waitFor(() =>
        expect(screen.queryByLabelText('close menu')).not.toBeInTheDocument(),
      );
    });

    it('closes after following a link', async () => {
      render(<AdminNav email="admin@test.com" />);
      fireEvent.click(screen.getByLabelText('menu'));

      const drawer = screen.getByLabelText('close menu').closest('aside') as HTMLElement;
      fireEvent.click(within(drawer).getAllByTestId('nav-link')[0]);
      await waitFor(() =>
        expect(screen.queryByLabelText('close menu')).not.toBeInTheDocument(),
      );
    });
  });
});
