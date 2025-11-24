import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(document.querySelector('.flex.h-screen')).toBeInTheDocument();
  });

  it('renders the default dashboard view', () => {
    render(<App />);
    // App starts with dashboard view by default
    expect(document.querySelector('main')).toBeInTheDocument();
  });

  it('has main layout structure', () => {
    const { container } = render(<App />);
    // Check for main structural elements
    const mainElement = container.querySelector('main');
    
    expect(mainElement).toBeInTheDocument();
    expect(mainElement).toHaveClass('flex-1', 'overflow-x-hidden', 'overflow-y-auto');
  });
});
