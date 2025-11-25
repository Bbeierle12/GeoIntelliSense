import React from 'react';

interface DateFilterProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
}

export const DateFilter: React.FC<DateFilterProps> = ({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange
}) => {
  return (
    <div className="flex flex-col md:flex-row gap-4 items-center bg-brand-bg-dark/50 p-3 rounded-md border border-brand-secondary">
      <label className="text-sm font-medium text-slate-300 flex-shrink-0">Filter Date Range:</label>
      <div className="flex gap-4 w-full md:w-auto">
        <input
          type="month"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          className="w-full p-2 bg-brand-bg-lighter border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-sm"
        />
        <span className="text-slate-400 self-center">-</span>
        <input
          type="month"
          value={endDate}
          onChange={(e) => onEndDateChange(e.target.value)}
          className="w-full p-2 bg-brand-bg-lighter border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-sm"
        />
      </div>
    </div>
  );
};