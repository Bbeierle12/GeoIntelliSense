import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { UserPreferencesProvider } from '../contexts/UserPreferencesContext';

// Components to test
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import { ErrorBoundary, ErrorFallback } from '../components/ErrorBoundary';
import { ErrorMessage, WarningMessage, InfoMessage } from '../components/ErrorMessage';
import { 
  ChartSkeleton, 
  TableSkeleton, 
  LoadingSpinner, 
  LoadingScreen 
} from '../components/LoadingStates';
import { AccessibleChart, DataTable, AQIIndicator } from '../components/AccessibleChart';

// Test wrapper component
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <UserPreferencesProvider>
    <BrowserRouter>
      {children}
    </BrowserRouter>
  </UserPreferencesProvider>
);

describe('Accessibility Tests', () => {
  describe('Sidebar Navigation', () => {
    it('has proper navigation role and aria-label', () => {
      render(<Sidebar />, { wrapper: TestWrapper });
      
      const nav = screen.getByRole('navigation');
      expect(nav).toHaveAttribute('aria-label', 'Main navigation');
    });

    it('navigation links have proper aria-labels with keyboard shortcuts', () => {
      render(<Sidebar />, { wrapper: TestWrapper });
      
      const dashboardLink = screen.getByRole('link', { name: /Dashboard/i });
      expect(dashboardLink).toHaveAttribute('aria-label', expect.stringContaining('Alt+D'));
    });

    it('icons are hidden from screen readers', () => {
      render(<Sidebar />, { wrapper: TestWrapper });
      
      // Icons should have aria-hidden="true"
      const svgs = document.querySelectorAll('nav svg');
      svgs.forEach(svg => {
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      });
    });

    it('provides screen reader hints about keyboard shortcuts', () => {
      render(<Sidebar />, { wrapper: TestWrapper });
      
      const hint = screen.getByText(/Press Shift\+\? to hear all keyboard shortcuts/i);
      expect(hint).toHaveClass('sr-only');
    });
  });

  describe('Header Component', () => {
    it('theme toggle button has proper aria-label', () => {
      render(<Header />, { wrapper: TestWrapper });
      
      const themeButton = screen.getByRole('button', { name: /Switch to/i });
      expect(themeButton).toHaveAttribute('aria-label');
    });
  });

  describe('Loading States', () => {
    it('ChartSkeleton has proper role and aria-label', () => {
      render(<ChartSkeleton />);
      
      const skeleton = screen.getByRole('status');
      expect(skeleton).toHaveAttribute('aria-label', 'Loading chart data');
    });

    it('TableSkeleton has proper role and aria-label', () => {
      render(<TableSkeleton rows={3} />);
      
      const skeleton = screen.getByRole('status');
      expect(skeleton).toHaveAttribute('aria-label', 'Loading table data');
    });

    it('LoadingSpinner has proper role and sr-only text', () => {
      render(<LoadingSpinner />);
      
      const spinner = screen.getByRole('status');
      expect(spinner).toBeInTheDocument();
      expect(screen.getByText('Loading...')).toHaveClass('sr-only');
    });

    it('LoadingScreen displays custom message', () => {
      render(<LoadingScreen message="Custom loading message" />);
      
      expect(screen.getByText('Custom loading message')).toBeInTheDocument();
    });
  });

  describe('Error Messages', () => {
    it('ErrorMessage has alert role', () => {
      render(<ErrorMessage error="Test error" />);
      
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
    });

    it('WarningMessage has proper role and aria-live', () => {
      render(<WarningMessage message="Test warning" />);
      
      const warning = screen.getByRole('alert');
      expect(warning).toHaveAttribute('aria-live', 'polite');
    });

    it('InfoMessage has proper role and aria-live', () => {
      render(<InfoMessage message="Test info" />);
      
      const info = screen.getByRole('status');
      expect(info).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('Error Boundary', () => {
    // Component that throws an error
    const ThrowError: React.FC = () => {
      throw new Error('Test error');
    };

    beforeEach(() => {
      // Suppress console.error for error boundary tests
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('renders fallback UI when child component throws', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );
      
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    });

    it('ErrorFallback has proper aria-live for screen readers', () => {
      render(<ErrorFallback error={new Error('Test')} />);
      
      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
    });

    it('Try Again button is accessible', () => {
      const resetFn = vi.fn();
      render(<ErrorFallback error={new Error('Test')} reset={resetFn} />);
      
      const button = screen.getByRole('button', { name: /Try again/i });
      expect(button).toBeInTheDocument();
      
      fireEvent.click(button);
      expect(resetFn).toHaveBeenCalled();
    });
  });

  describe('AQI Indicator', () => {
    it('provides screen reader text with AQI category', () => {
      render(<AQIIndicator value={75} />);
      
      const srText = screen.getByText(/AQI 75: Moderate/i);
      expect(srText).toHaveClass('sr-only');
    });

    it('icon is hidden from screen readers', () => {
      const { container } = render(<AQIIndicator value={150} showIcon />);
      
      const iconSpan = container.querySelector('[aria-hidden="true"]');
      expect(iconSpan).toBeInTheDocument();
    });
  });

  describe('Accessible Chart', () => {
    const mockData = [
      { month: 'Jan', value: 100 },
      { month: 'Feb', value: 120 },
    ];
    
    const mockColumns = [
      { key: 'month', header: 'Month' },
      { key: 'value', header: 'Value' },
    ];

    it('renders chart with proper aria-label', () => {
      render(
        <AccessibleChart
          title="Test Chart"
          ariaLabel="Test chart showing monthly values"
          data={mockData}
          columns={mockColumns}
        >
          <div>Chart content</div>
        </AccessibleChart>
      );
      
      const chart = screen.getByRole('img');
      expect(chart).toHaveAttribute('aria-label', 'Test chart showing monthly values');
    });

    it('toggle button shows/hides data table', async () => {
      const user = userEvent.setup();
      
      render(
        <AccessibleChart
          title="Test Chart"
          ariaLabel="Test chart"
          data={mockData}
          columns={mockColumns}
        >
          <div>Chart content</div>
        </AccessibleChart>
      );
      
      // Initially shows chart
      expect(screen.getByRole('img')).toBeInTheDocument();
      
      // Click toggle to show table
      const toggleButton = screen.getByRole('button', { name: /Show Data Table/i });
      await user.click(toggleButton);
      
      // Now shows table
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('toggle button has proper aria-expanded state', async () => {
      const user = userEvent.setup();
      
      render(
        <AccessibleChart
          title="Test Chart"
          ariaLabel="Test chart"
          data={mockData}
          columns={mockColumns}
        >
          <div>Chart content</div>
        </AccessibleChart>
      );
      
      const toggleButton = screen.getByRole('button', { name: /Show Data Table/i });
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
      
      await user.click(toggleButton);
      expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('Data Table', () => {
    const mockData = [
      { month: 'Jan', aqi: 50, pm25: 12 },
      { month: 'Feb', aqi: 75, pm25: 18 },
    ];
    
    const mockColumns = [
      { key: 'month', header: 'Month' },
      { key: 'aqi', header: 'AQI' },
      { key: 'pm25', header: 'PM2.5' },
    ];

    it('has proper table structure with caption', () => {
      render(<DataTable data={mockData} columns={mockColumns} caption="Test caption" />);
      
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('Test caption')).toHaveClass('sr-only');
    });

    it('has proper column headers', () => {
      render(<DataTable data={mockData} columns={mockColumns} caption="Test" />);
      
      expect(screen.getByRole('columnheader', { name: 'Month' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'AQI' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'PM2.5' })).toBeInTheDocument();
    });
  });

  describe('Keyboard Navigation', () => {
    it('interactive elements are keyboard focusable', async () => {
      const user = userEvent.setup();
      
      render(<Sidebar />, { wrapper: TestWrapper });
      
      // Tab through navigation links
      await user.tab();
      expect(document.activeElement).toHaveAttribute('href', '/dashboard');
      
      await user.tab();
      expect(document.activeElement).toHaveAttribute('href', '/chat');
    });

    it('focus styles are visible', () => {
      render(<Sidebar />, { wrapper: TestWrapper });
      
      const link = screen.getByRole('link', { name: /Dashboard/i });
      expect(link.className).toContain('focus:ring');
    });
  });
});
