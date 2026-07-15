import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Term } from '@/components/Term';

// Mock i18n
vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

// Mock glossary
vi.mock('@/lib/glossary', () => ({
  GLOSSARY: {
    MFE: true,
    MAE: true,
    Captured: true,
  },
}));

describe('Term', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children when no description available', () => {
    render(<Term name="UnknownTerm">Custom</Term>);
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('renders term name when no children provided', () => {
    render(<Term name="MFE" />);
    expect(screen.getByText('MFE')).toBeInTheDocument();
  });

  it('shows tooltip on hover when term in glossary', async () => {
    render(<Term name="MFE" />);

    const term = screen.getByText('MFE');
    await act(async () => {
      fireEvent.mouseEnter(term);
    });

    await waitFor(() => {
      expect(screen.getByText('term.MFE')).toBeInTheDocument();
    });
  });

  it('uses explicit desc over glossary lookup', async () => {
    render(<Term name="MFE" desc="Custom description" />);

    const term = screen.getByText('MFE');
    await act(async () => {
      fireEvent.mouseEnter(term);
    });

    await waitFor(() => {
      expect(screen.getByText('Custom description')).toBeInTheDocument();
      expect(screen.queryByText('term.MFE')).not.toBeInTheDocument();
    });
  });

  it('hides tooltip on mouse leave', async () => {
    render(<Term name="MFE" />);

    const term = screen.getByText('MFE');
    await act(async () => {
      fireEvent.mouseEnter(term);
    });
    await waitFor(() => {
      expect(screen.getByText('term.MFE')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.mouseLeave(term);
    });
    expect(screen.queryByText('term.MFE')).not.toBeInTheDocument();
  });

  it('shows header only when term has glossary entry', async () => {
    render(<Term name="MFE" />);
    const term = screen.getByText('MFE');
    await act(async () => {
      fireEvent.mouseEnter(term);
    });
    await waitFor(() => {
      const headers = screen.getAllByText('MFE').filter((el) => el.className.includes('font-medium'));
      expect(headers.length).toBeGreaterThan(0);
    });
  });

  it('applies custom className', () => {
    render(<Term name="MFE" className="custom-class" />);
    expect(screen.getByText('MFE')).toHaveClass('custom-class');
  });
});