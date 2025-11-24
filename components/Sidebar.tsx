import React from 'react';
import { NavLink } from 'react-router-dom';
import { DashboardIcon } from './icons/DashboardIcon';
import { ChatIcon } from './icons/ChatIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { MapIcon } from './icons/MapIcon';

const Sidebar: React.FC = () => {
  const navItems = [
    { id: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
    { id: 'chat', path: '/chat', label: 'Chat Analyst', icon: ChatIcon },
    { id: 'analysis', path: '/analysis', label: 'Advanced Analysis', icon: SparklesIcon },
    { id: 'maps', path: '/maps', label: 'Interactive Map', icon: MapIcon },
  ] as const;

  return (
    <nav className="w-20 md:w-64 bg-brand-bg-light p-2 md:p-4 flex flex-col space-y-2">
      {navItems.map((item) => (
        <NavLink
          key={item.id}
          to={item.path}
          className={({ isActive }) =>
            `flex items-center justify-center md:justify-start space-x-3 p-3 rounded-lg transition-all duration-200 ${
              isActive
                ? 'bg-brand-primary text-white shadow-lg'
                : 'text-slate-400 hover:bg-brand-bg-lighter hover:text-slate-200'
            }`
          }
        >
          <item.icon className="w-6 h-6 flex-shrink-0" />
          <span className="hidden md:inline font-semibold">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
};

export default Sidebar;