import React from 'react';
import type { ViewType } from '../types';
import { DashboardIcon } from './icons/DashboardIcon';
import { ChatIcon } from './icons/ChatIcon';
import { SparklesIcon } from './icons/SparklesIcon';

interface SidebarProps {
  activeView: ViewType;
  setActiveView: (view: ViewType) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeView, setActiveView }) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
    { id: 'chat', label: 'Chat Analyst', icon: ChatIcon },
    { id: 'analysis', label: 'Advanced Analysis', icon: SparklesIcon },
  ] as const;

  return (
    <nav className="w-20 md:w-64 bg-brand-bg-light p-2 md:p-4 flex flex-col space-y-2">
      {navItems.map((item) => {
        const isActive = activeView === item.id;
        return (
          <button
            key={item.id}
            onClick={() => setActiveView(item.id)}
            className={`flex items-center justify-center md:justify-start space-x-3 p-3 rounded-lg transition-all duration-200 ${
              isActive
                ? 'bg-brand-primary text-white shadow-lg'
                : 'text-slate-400 hover:bg-brand-bg-lighter hover:text-slate-200'
            }`}
          >
            <item.icon className="w-6 h-6 flex-shrink-0" />
            <span className="hidden md:inline font-semibold">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default Sidebar;
