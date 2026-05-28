import React from 'react';
import { useUserPreferences } from '../contexts/UserPreferencesContext';
import { AirIcon } from './icons/AirIcon';

const SunIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="12" cy="12" r="5"></circle>
    <line x1="12" y1="1" x2="12" y2="3"></line>
    <line x1="12" y1="21" x2="12" y2="23"></line>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
    <line x1="1" y1="12" x2="3" y2="12"></line>
    <line x1="21" y1="12" x2="23" y2="12"></line>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
  </svg>
);

const MoonIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
  </svg>
);

const Header: React.FC = () => {
  const { preferences, toggleTheme } = useUserPreferences();

  return (
    <header className="bg-brand-bg-light shadow-md p-4 flex items-center justify-between z-10">
      <div className="flex items-center space-x-3">
        <AirIcon className="w-8 h-8 text-brand-primary" />
        <h1 className="text-xl md:text-2xl font-bold text-slate-100">GeoIntelliSense: San Joaquin Valley</h1>
      </div>
      <button
        onClick={toggleTheme}
        className="p-2 rounded-lg bg-brand-bg-lighter hover:bg-brand-bg-dark transition-colors"
        title={`Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} mode`}
        aria-label={`Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {preferences.theme === 'dark' ? (
          <SunIcon className="w-5 h-5 text-yellow-400" />
        ) : (
          <MoonIcon className="w-5 h-5 text-slate-400" />
        )}
      </button>
    </header>
  );
};

export default Header;
