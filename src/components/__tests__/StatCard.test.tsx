import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StatCard, StatRow } from '@/components/StatCard';

describe('StatCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders label and value', () => {
    render(<StatCard label="MFE" value="5.5%" tone="profit" />);
    expect(screen.getByText('MFE')).toBeInTheDocument();
    const valueEl = screen.getByText('5.5%');
    expect(valueEl).toBeInTheDocument();
    expect(valueEl).toHaveClass('text-profit');
  });

  it('applies loss tone class to value', () => {
    render(<StatCard label="Loss" value="2%" tone="loss" />);
    expect(screen.getByText('2%')).toHaveClass('text-loss');
  });

  it('applies accent tone class to value', () => {
    render(<StatCard label="Accent" value="75%" tone="accent" />);
    expect(screen.getByText('75%')).toHaveClass('text-accent');
  });

  it('shows positive change badge with + sign and arrow', () => {
    render(<StatCard label="Change" value="10%" change={1.5} />);
    const badge = screen.getByText('+1.5%');
    expect(badge).toBeInTheDocument();
    // up → green profit styling
    expect(badge.className).toContain('text-profit');
  });

  it('shows negative change badge without + sign', () => {
    render(<StatCard label="Change" value="10%" change={-3} />);
    expect(screen.getByText('-3.0%')).toBeInTheDocument();
  });

  it('renders custom changeUnit (percentage points)', () => {
    render(<StatCard label="Winrate" value="55%" change={2} changeUnit=" pp" />);
    expect(screen.getByText('+2.0 pp')).toBeInTheDocument();
  });

  it('applies changeHint as title on the badge', () => {
    render(<StatCard label="Change" value="10%" change={1} changeHint="30d" />);
    expect(screen.getByTitle('30d')).toBeInTheDocument();
  });

  it('renders hint text when provided', () => {
    render(<StatCard label="Hint" value="70%" hint="по сигналу" />);
    expect(screen.getByText('по сигналу')).toBeInTheDocument();
  });

  it('renders neither hint nor change block when absent', () => {
    const { container } = render(<StatCard label="Plain" value="1" />);
    // only the card + label + value divs, no extra flex row
    expect(container.querySelectorAll('.mt-1\\.5').length).toBe(0);
  });
});

describe('StatRow', () => {
  it('renders label and value', () => {
    render(<StatRow label="Symbol" value="BTCUSDT" />);
    expect(screen.getByText('Symbol')).toBeInTheDocument();
    expect(screen.getByText('BTCUSDT')).toBeInTheDocument();
  });

  it('applies profit tone class', () => {
    render(<StatRow label="P" value="100" tone="profit" />);
    expect(screen.getByText('100')).toHaveClass('text-profit');
  });

  it('applies loss tone class', () => {
    render(<StatRow label="L" value="-50" tone="loss" />);
    expect(screen.getByText('-50')).toHaveClass('text-loss');
  });
});