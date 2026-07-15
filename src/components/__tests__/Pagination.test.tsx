import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Pagination } from '@/components/Pagination';

// Mock scrollIntoView which may not be fully implemented in JSDOM
beforeEach(() => {
  vi.clearAllMocks();
  // @ts-ignore - mocking existing method
  Element.prototype.scrollIntoView = vi.fn();
});

describe('Pagination', () => {
  const defaultProps = {
    page: 1,
    totalPages: 10,
    onChange: vi.fn(),
    prevLabel: 'Prev',
    nextLabel: 'Next',
    pageAriaLabel: 'Page',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when only one page', () => {
    const { container } = render(<Pagination {...defaultProps} totalPages={1} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders page indicator and prev/next buttons', () => {
    render(<Pagination {...defaultProps} />);
    expect(screen.getByText('1 / 10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('disables prev button on first page', () => {
    render(<Pagination {...defaultProps} page={1} />);
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
  });

  it('disables next button on last page', () => {
    render(<Pagination {...defaultProps} page={10} />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('calls onChange with previous page on prev click', () => {
    render(<Pagination {...defaultProps} page={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(defaultProps.onChange).toHaveBeenCalledWith(4);
  });

  it('calls onChange with next page on next click', () => {
    render(<Pagination {...defaultProps} page={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(defaultProps.onChange).toHaveBeenCalledWith(6);
  });

  it('opens page dropdown on toggle click', async () => {
    render(<Pagination {...defaultProps} />);
    const toggle = screen.getByRole('button', { name: 'Page' });
    await act(async () => {
      fireEvent.click(toggle);
    });
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    // All page options present
    expect(screen.getAllByRole('option').length).toBe(10);
  });

  it('selects a page from dropdown', async () => {
    render(<Pagination {...defaultProps} />);
    const toggle = screen.getByRole('button', { name: 'Page' });
    await act(async () => {
      fireEvent.click(toggle);
    });
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    const option7 = screen.getByRole('option', { name: '7' });
    await act(async () => {
      fireEvent.click(option7);
    });
    expect(defaultProps.onChange).toHaveBeenCalledWith(7);
  });

  it('closes dropdown on Escape', async () => {
    render(<Pagination {...defaultProps} />);
    const toggle = screen.getByRole('button', { name: 'Page' });
    await act(async () => {
      fireEvent.click(toggle);
    });
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});