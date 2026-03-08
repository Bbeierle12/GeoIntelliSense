import React from 'react';
import { NavLink } from 'react-router-dom';
import { DashboardIcon } from './icons/DashboardIcon';
import { AirIcon } from './icons/AirIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { TrendingUpIcon } from './icons/TrendingUpIcon';
import { SettingsIcon } from './icons/SettingsIcon';

const Sidebar: React.FC = () => {
  const navItems = [
    { 
      id: 'dashboard', 
      path: '/dashboard', 
      label: 'Dashboard', 
      icon: DashboardIcon,
      shortcut: 'Alt+D',
      description: 'View environmental data overview and trends'
    },
    { 
      id: 'air-quality-map', 
      path: '/air-quality-map', 
      label: 'Air Quality Map', 
      icon: AirIcon,
      shortcut: 'Alt+M',
      description: 'Interactive 3D air quality visualization'
    },
    {
      id: 'explore',
      path: '/explore',
      label: 'Data Explorer',
      icon: TrendingUpIcon,
      shortcut: 'Alt+E',
      description: 'Explore correlations across data sources'
    },
    {
      id: 'analysis',
      path: '/analysis',
      label: 'AI Analysis',
      icon: SparklesIcon,
      shortcut: 'Alt+A',
      description: 'AI-powered environmental analysis'
    },
  ] as const;

  const settingsItem = {
    id: 'settings',
    path: '/settings',
    label: 'Settings',
    icon: SettingsIcon,
    shortcut: 'Alt+S',
    description: 'Customize your preferences and settings'
  };

  return (
    <nav 
      id="navigation"
      className="w-20 md:w-64 bg-brand-bg-light p-2 md:p-4 flex flex-col"
      aria-label="Main navigation"
      role="navigation"
    >
      <ul className="space-y-2 flex-1" role="list">
        {navItems.map((item) => (
          <li key={item.id}>
            <NavLink
              to={item.path}
              className={({ isActive }) =>
                `flex items-center justify-center md:justify-start space-x-3 p-3 rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-brand-bg-light ${
                  isActive
                    ? 'bg-brand-primary text-white shadow-lg'
                    : 'text-slate-400 hover:bg-brand-bg-lighter hover:text-slate-200'
                }`
              }
              aria-label={`${item.label} (${item.shortcut})`}
              aria-describedby={`nav-desc-${item.id}`}
              title={`${item.label} - ${item.shortcut}`}
            >
              <item.icon className="w-6 h-6 flex-shrink-0" aria-hidden="true" />
              <span className="hidden md:inline font-semibold">{item.label}</span>
            </NavLink>
            <span id={`nav-desc-${item.id}`} className="sr-only">
              {item.description}
            </span>
          </li>
        ))}
      </ul>
      
      {/* Settings link at bottom */}
      <div className="pt-4 border-t border-border-color">
        <NavLink
          to={settingsItem.path}
          className={({ isActive }) =>
            `flex items-center justify-center md:justify-start space-x-3 p-3 rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-brand-bg-light ${
              isActive
                ? 'bg-brand-primary text-white shadow-lg'
                : 'text-slate-400 hover:bg-brand-bg-lighter hover:text-slate-200'
            }`
          }
          aria-label={`${settingsItem.label} (${settingsItem.shortcut})`}
          aria-describedby={`nav-desc-${settingsItem.id}`}
          title={`${settingsItem.label} - ${settingsItem.shortcut}`}
        >
          <settingsItem.icon className="w-6 h-6 flex-shrink-0" aria-hidden="true" />
          <span className="hidden md:inline font-semibold">{settingsItem.label}</span>
        </NavLink>
        <span id={`nav-desc-${settingsItem.id}`} className="sr-only">
          {settingsItem.description}
        </span>
      </div>
      
      {/* Keyboard shortcuts hint for screen readers */}
      <div className="sr-only" aria-live="polite">
        Press Shift+? to hear all keyboard shortcuts
      </div>
    </nav>
  );
};

export default Sidebar;