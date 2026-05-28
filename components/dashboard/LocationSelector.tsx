import React from 'react';
import { LocationKey, locations } from '../../data/dashboardData';

interface LocationSelectorProps {
  selectedLocations: LocationKey[];
  onLocationToggle: (location: LocationKey) => void;
}

export const LocationSelector: React.FC<LocationSelectorProps> = ({
  selectedLocations,
  onLocationToggle
}) => {
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-slate-400 mb-2">Select Locations for Comparison:</label>
      <div className="flex flex-wrap gap-2">
        {locations.map(loc => (
          <button
            key={loc}
            onClick={() => onLocationToggle(loc)}
            className={`px-4 py-2 text-sm font-semibold rounded-full transition-all duration-200 ${
              selectedLocations.includes(loc)
                ? 'bg-brand-primary text-white shadow-md'
                : 'bg-brand-bg-lighter text-slate-300 hover:bg-brand-secondary'
            }`}
          >
            {loc}
          </button>
        ))}
      </div>
    </div>
  );
};