import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminDonate from '@/components/AdminDonate';

function makeWallets() {
  return [
    { id: 'w1', network: 'TRC20', coin: 'USDT', address: 'addr1', enabled: true },
    { id: 'w2', network: 'ERC20', coin: 'USDT', address: 'addr2', enabled: false },
  ];
}

describe('AdminDonate', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows loading then wallet list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ wallets: makeWallets() }) }));

    render(<AdminDonate />);
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByDisplayValue('TRC20')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('addr1')).toBeInTheDocument();
    expect(screen.getByText('Скрыт')).toBeInTheDocument();
    expect(screen.getByText('Показывается')).toBeInTheDocument();
  });

  it('adds a new wallet', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ wallets: [...makeWallets(), { id: 'w3', network: 'BEP20', coin: 'USDT', address: 'addr3', enabled: true }] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ wallets: makeWallets() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminDonate />);
    await waitFor(() => expect(screen.getByDisplayValue('TRC20')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Сеть, напр. ERC20 (Ethereum)'), { target: { value: 'BEP20' } });
    const addrInputs = screen.getAllByPlaceholderText('Адрес кошелька');
    fireEvent.change(addrInputs[addrInputs.length - 1], { target: { value: 'addr3' } });

    fireEvent.click(screen.getByText('Добавить'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/donate',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('toggles wallet enabled state', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ wallets: makeWallets() }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ wallets: makeWallets() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminDonate />);
    await waitFor(() => expect(screen.getByDisplayValue('TRC20')).toBeInTheDocument());

    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/donate/w1', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('shows save button when edited and saves', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ wallets: makeWallets() }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ wallets: makeWallets() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminDonate />);
    await waitFor(() => expect(screen.getByDisplayValue('TRC20')).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue('TRC20'), { target: { value: 'TRC20-new' } });

    const saveBtn = await screen.findByText('Сохранить');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/donate/w1', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('removes a wallet after confirm', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ wallets: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ wallets: makeWallets() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminDonate />);
    await waitFor(() => expect(screen.getByDisplayValue('TRC20')).toBeInTheDocument());

    const deleteButtons = screen.getAllByTitle('Удалить');
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/donate/w1', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  it('shows error message on failed save', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'PATCH') {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Ошибка сохранения' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ wallets: makeWallets() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminDonate />);
    await waitFor(() => expect(screen.getByDisplayValue('TRC20')).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue('TRC20'), { target: { value: 'X' } });
    fireEvent.click(await screen.findByText('Сохранить'));

    await waitFor(() => {
      expect(screen.getByText('Ошибка сохранения')).toBeInTheDocument();
    });
  });
});
