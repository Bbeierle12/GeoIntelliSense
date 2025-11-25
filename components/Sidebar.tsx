import React from 'react';
import { NavLink } from 'react-router-dom';
import { DashboardIcon } from './icons/DashboardIcon';
import { ChatIcon } from './icons/ChatIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { MapIcon } from './icons/MapIcon';

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
      id: 'chat', 
      path: '/chat', 
      label: 'Chat Analyst', 
      icon: ChatIcon,
      shortcut: 'Alt+C',
      description: 'Ask questions about environmental data'
    },
    { 
      id: 'analysis', 
      path: '/analysis', 
      label: 'Advanced Analysis', 
      icon: SparklesIcon,
      shortcut: 'Alt+A',
      description: 'Perform in-depth data analysis'
    },
    { 
      id: 'maps', 
      path: '/maps', 
      label: 'Interactive Map', 
      icon: MapIcon,
      shortcut: 'Alt+M',
      description: 'Explore data on an interactive map'
    },
  ] as const;

  return (
    <nav 
      id="navigation"
      className="w-20 md:w-64 bg-brand-bg-light p-2 md:p-4 flex flex-col space-y-2"
      aria-label="Main navigation"
      role="navigation"
    >
      <ul className="space-y-2" role="list">
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
      
      {/* Keyboard shortcuts hint for screen readers */}
      <div className="sr-only" aria-live="polite">
        Press Shift+? to hear all keyboard shortcuts
      </div>
    </nav>
  );
};

export default Sidebar;