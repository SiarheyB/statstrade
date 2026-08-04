import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminFeatures from '@/components/AdminFeatures';

function makeRows() {
  return [
    {
      key: 'exitEfficiency',
      label: 'Exit efficiency',
      description: 'Some description',
      fieldHelp: { maxTrades: 'max trades help' },
      value: { enabled: true, maxTrades: 50 },
    },
    {
      key: 'forex',
      label: 'Forex hidden',
      description: '',
      fieldHelp: {},
      value: { enabled: false },
    },
  ];
}

describe('AdminFeatures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows loading state before rows arrive', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<AdminFeatures />);
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
  });

  it('renders visible feature rows and hides forex', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ features: makeRows() }) }));

    render(<AdminFeatures />);

    await waitFor(() => {
      expect(screen.getByText('Exit efficiency')).toBeInTheDocument();
    });
    expect(screen.queryByText('Forex hidden')).not.toBeInTheDocument();
    expect(screen.getByText('Сейчас включено — видно всем пользователям.')).toBeInTheDocument();
  });

  it('toggles feature enabled via PATCH', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'PATCH') {
        const rows = makeRows();
        rows[0].value.enabled = false;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ features: rows }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ features: makeRows() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminFeatures />);
    await waitFor(() => expect(screen.getByText('Exit efficiency')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/features',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ key: 'exitEfficiency', enabled: false }),
        }),
      );
    });
  });

  it('edits numeric config field and saves, showing saved indicator', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ features: makeRows() }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ features: makeRows() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminFeatures />);
    await waitFor(() => expect(screen.getByText('Exit efficiency')).toBeInTheDocument());

    const input = screen.getByDisplayValue('50');
    fireEvent.change(input, { target: { value: '75' } });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/features',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ key: 'exitEfficiency', config: { maxTrades: 75 } }),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Сохранено')).toBeInTheDocument();
    });
  });
});
