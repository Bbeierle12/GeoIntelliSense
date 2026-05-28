/**
 * Routing Tests for GeoIntelliSense
 * 
 * These tests verify that:
 * - React Router navigation works correctly
 * - NavLink active states are applied correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { UserPreferencesProvider } from '../contexts/UserPreferencesContext';

// Mock fetch for API calls
const mockFetch = vi.fn().mockImplementation((url: string) => {
  if (url.includes('/api/health')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'ok' }),
    });
  }
  if (url.includes('/api/maps-config')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ apiKey: 'mock-api-key' }),
    });
  }
  return Promise.resolve({
    ok: false,
    status: 404,
    json: () => Promise.resolve({ error: 'Not found' }),
  });
});

// Test wrapper for Sidebar tests
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <UserPreferencesProvider>{children}</UserPreferencesProvider>
);

describe('Routing Tests', () => {
  beforeEach(() => {
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('NavLink Active States', () => {
    it('should apply active class to Dashboard link when on /dashboard', () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      const dashboardLink = screen.getByRole('link', { name: /dashboard/i });
      
      // The active class includes 'bg-brand-primary'
      expect(dashboardLink).toHaveClass('bg-brand-primary');
    });

    it('should apply active class to Chat link when on /chat', () => {
      render(
        <MemoryRouter initialEntries={['/chat']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      const chatLink = screen.getByRole('link', { name: /chat analyst/i });
      
      expect(chatLink).toHaveClass('bg-brand-primary');
    });

    it('should apply active class to Analysis link when on /analysis', () => {
      render(
        <MemoryRouter initialEntries={['/analysis']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      const analysisLink = screen.getByRole('link', { name: /advanced analysis/i });
      
      expect(analysisLink).toHaveClass('bg-brand-primary');
    });

    it('should apply active class to Maps link when on /maps', () => {
      render(
        <MemoryRouter initialEntries={['/maps']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      const mapsLink = screen.getByRole('link', { name: /interactive map/i });
      
      expect(mapsLink).toHaveClass('bg-brand-primary');
    });

    it('should not apply active class to inactive links', () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      const chatLink = screen.getByRole('link', { name: /chat analyst/i });
      const analysisLink = screen.getByRole('link', { name: /advanced analysis/i });
      const mapsLink = screen.getByRole('link', { name: /interactive map/i });
      
      expect(chatLink).not.toHaveClass('bg-brand-primary');
      expect(analysisLink).not.toHaveClass('bg-brand-primary');
      expect(mapsLink).not.toHaveClass('bg-brand-primary');
    });
  });

  describe('Sidebar Navigation', () => {
    it('should render all navigation links in the sidebar', () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      const sidebar = screen.getByRole('navigation');
      expect(within(sidebar).getByText('Dashboard')).toBeInTheDocument();
      expect(within(sidebar).getByText('Chat Analyst')).toBeInTheDocument();
      expect(within(sidebar).getByText('Advanced Analysis')).toBeInTheDocument();
      expect(within(sidebar).getByText('Interactive Map')).toBeInTheDocument();
    });

    it('should have correct href attributes on navigation links', () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/dashboard');
      expect(screen.getByRole('link', { name: /chat analyst/i })).toHaveAttribute('href', '/chat');
      expect(screen.getByRole('link', { name: /advanced analysis/i })).toHaveAttribute('href', '/analysis');
      expect(screen.getByRole('link', { name: /interactive map/i })).toHaveAttribute('href', '/maps');
    });

    it('should navigate to different routes when clicking links', async () => {
      const user = userEvent.setup();
      
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      // Verify dashboard is active initially
      expect(screen.getByRole('link', { name: /dashboard/i })).toHaveClass('bg-brand-primary');
      
      // Click on chat link
      await user.click(screen.getByRole('link', { name: /chat analyst/i }));
      
      // Verify chat is now active
      await waitFor(() => {
        expect(screen.getByRole('link', { name: /chat analyst/i })).toHaveClass('bg-brand-primary');
        expect(screen.getByRole('link', { name: /dashboard/i })).not.toHaveClass('bg-brand-primary');
      });
    });
  });

  describe('Navigation Links Accessibility', () => {
    it('should have accessible navigation links', () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      const links = screen.getAllByRole('link');
      
      // Each link should have text content
      links.forEach(link => {
        expect(link).toHaveAttribute('href');
        expect(link.textContent).not.toBe('');
      });
    });

    it('should have proper navigation landmark', () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });
  });

  describe('Route URL Structure', () => {
    it('Dashboard should use /dashboard path', () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      const dashboardLink = screen.getByRole('link', { name: /dashboard/i });
      expect(dashboardLink).toHaveAttribute('href', '/dashboard');
    });

    it('Chat should use /chat path', () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      const chatLink = screen.getByRole('link', { name: /chat analyst/i });
      expect(chatLink).toHaveAttribute('href', '/chat');
    });

    it('Analysis should use /analysis path', () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      const analysisLink = screen.getByRole('link', { name: /advanced analysis/i });
      expect(analysisLink).toHaveAttribute('href', '/analysis');
    });

    it('Maps should use /maps path', () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <TestWrapper>
            <Sidebar />
          </TestWrapper>
        </MemoryRouter>
      );
      
      const mapsLink = screen.getByRole('link', { name: /interactive map/i });
      expect(mapsLink).toHaveAttribute('href', '/maps');
    });
  });
});
