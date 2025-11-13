import React from 'react';
import { AirIcon } from './icons/AirIcon';

const Header: React.FC = () => {
  return (
    <header className="bg-brand-bg-light shadow-md p-4 flex items-center space-x-3 z-10">
      <AirIcon className="w-8 h-8 text-brand-primary" />
      <h1 className="text-xl md:text-2xl font-bold text-slate-100">GeoIntelliSense: San Joaquin Valley</h1>
    </header>
  );
};

export default Header;
