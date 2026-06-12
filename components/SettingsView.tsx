import React, { useState, useRef, useEffect } from 'react';
import { 
  useUserPreferences, 
  Theme,
  DataSettings,
  NotificationSettings,
  AccessibilitySettings,
  AnalysisSettings 
} from '../contexts/UserPreferencesContext';
import { 
  TemperatureUnit, 
  WindSpeedUnit, 
  PressureUnit, 
  FontSize, 
  RefreshInterval,
  AnalysisTool 
} from '../types';
import { SunIcon } from './icons/SunIcon';
import { MoonIcon } from './icons/MoonIcon';
import { GaugeIcon } from './icons/GaugeIcon';
import { WarningIcon } from './icons/WarningIcon';
import { EyeIcon } from './icons/EyeIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { MapIcon } from './icons/MapIcon';
import { KeyIcon } from './icons/KeyIcon';
import { LightbulbIcon } from './icons/LightbulbIcon';
import { SettingsIcon } from './icons/SettingsIcon';
import { gatewayBaseUrl, ingestionBaseUrl } from '../config/api';

// Reusable components
interface SettingsSectionProps {
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

const SettingsSection: React.FC<SettingsSectionProps> = ({ 
  title, 
  description, 
  icon, 
  children 
}) => (
  <section 
    className="bg-brand-bg-light p-6 rounded-lg shadow-lg"
    aria-labelledby={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}
  >
    <div className="flex items-center gap-3 mb-4">
      <div className="text-brand-primary">{icon}</div>
      <div>
        <h2 
          id={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}
          className="text-lg font-semibold text-text-primary"
        >
          {title}
        </h2>
        {description && (
          <p className="text-sm text-text-muted">{description}</p>
        )}
      </div>
    </div>
    <div className="space-y-4">
      {children}
    </div>
  </section>
);

interface SettingRowProps {
  label: string;
  description?: string;
  htmlFor?: string;
  children: React.ReactNode;
}

const SettingRow: React.FC<SettingRowProps> = ({ 
  label, 
  description, 
  htmlFor, 
  children 
}) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-3 border-b border-border-color last:border-0">
    <div className="flex-1">
      <label 
        htmlFor={htmlFor} 
        className="block text-sm font-medium text-text-primary"
      >
        {label}
      </label>
      {description && (
        <p className="text-xs text-text-muted mt-0.5">{description}</p>
      )}
    </div>
    <div className="flex items-center gap-2">
      {children}
    </div>
  </div>
);

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id: string;
  label: string;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ 
  checked, 
  onChange, 
  id, 
  label 
}) => (
  <button
    type="button"
    role="switch"
    id={id}
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`
      relative inline-flex h-6 w-11 items-center rounded-full transition-colors
      focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-brand-bg-light
      ${checked ? 'bg-brand-primary' : 'bg-slate-600'}
    `}
  >
    <span
      className={`
        inline-block h-4 w-4 transform rounded-full bg-white transition-transform
        ${checked ? 'translate-x-6' : 'translate-x-1'}
      `}
    />
  </button>
);

interface SelectProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  id: string;
}

function Select<T extends string | number>({ 
  value, 
  onChange, 
  options, 
  id 
}: SelectProps<T>) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="
        bg-brand-bg-dark border border-border-color rounded-md px-3 py-1.5 text-sm text-text-primary
        focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent
        min-w-[140px]
      "
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  id: string;
  unit?: string;
}

const Slider: React.FC<SliderProps> = ({ 
  value, 
  onChange, 
  min, 
  max, 
  step = 1, 
  id, 
  unit = '' 
}) => (
  <div className="flex items-center gap-3 min-w-[200px]">
    <input
      type="range"
      id={id}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className="flex-1 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-brand-primary"
    />
    <span className="text-sm text-text-secondary min-w-[50px] text-right">
      {value}{unit}
    </span>
  </div>
);

// Data Source Toggles Component
const DataSourceToggles: React.FC = () => {
  const [sources, setSources] = useState<Record<string, { enabled: boolean; description: string }>>({});
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const adminToken = import.meta.env.VITE_ADMIN_TOKEN?.trim() || '';
  const adminHeaders = adminToken ? { 'X-Admin-Token': adminToken } : {};

  const fetchSources = async () => {
    try {
      const res = await fetch(`${gatewayBaseUrl}/api/admin/sources`, {
        headers: adminHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        setSources(data.sources || {});
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchSources(); }, []);

  const toggleSource = async (source: string, enable: boolean) => {
    setToggling(source);
    try {
      const action = enable ? 'enable' : 'disable';
      await fetch(`${gatewayBaseUrl}/api/admin/sources/${source}/${action}`, {
        method: 'POST',
        headers: adminHeaders,
      });
      setSources(prev => ({
        ...prev,
        [source]: { ...prev[source], enabled: enable },
      }));
    } catch { /* ignore */ }
    setToggling(null);
  };

  const allEnabled = Object.values(sources).every(s => s.enabled);

  const toggleAll = async (enable: boolean) => {
    setToggling('all');
    try {
      const action = enable ? 'enable-all' : 'disable-all';
      await fetch(`${gatewayBaseUrl}/api/admin/sources/${action}`, {
        method: 'POST',
        headers: adminHeaders,
      });
      setSources(prev => {
        const updated = { ...prev };
        for (const key of Object.keys(updated)) {
          updated[key] = { ...updated[key], enabled: enable };
        }
        return updated;
      });
    } catch { /* ignore */ }
    setToggling(null);
  };

  if (loading) {
    return <div className="text-sm text-text-muted animate-pulse">Loading sources...</div>;
  }

  const SOURCE_LABELS: Record<string, string> = {
    // Real-time polling
    purpleair: 'PurpleAir (Live AQI)',
    usgs_earthquakes: 'USGS Earthquakes',
    nasa_firms: 'NASA FIRMS (Fires)',
    usgs_water: 'USGS Water Levels',
    inversion: 'Inversion Detection',
    // On-demand
    airnow: 'AirNow (EPA Monitors)',
    nws_forecast: 'NWS Weather Forecast',
    noaa_cdo: 'NOAA CDO (Historical Weather)',
    epa_aqs: 'EPA AQS (Historical AQI)',
    census: 'U.S. Census Demographics',
    calgem: 'CalGEM (Oil/Gas Wells)',
    calenviroscreen: 'CalEnviroScreen (Env. Justice)',
    cropscape: 'CropScape (Agriculture)',
    caltrans: 'Caltrans (Traffic)',
    wqp: 'Water Quality Portal',
    landsat: 'Landsat Imagery',
    sentinel: 'Sentinel-2 Tiles',
    dem: 'USGS 3DEP Elevation',
  };

  const SOURCE_COST: Record<string, string> = {
    purpleair: 'API key (rate-limited)',
    airnow: 'API key',
    nasa_firms: 'API key',
    noaa_cdo: 'API key',
    epa_aqs: 'API key (not configured)',
    usgs_water: 'Free',
    nws_forecast: 'Free',
    inversion: 'Free',
    usgs_earthquakes: 'Free',
    census: 'Free (optional key)',
    calgem: 'Free',
    calenviroscreen: 'Free',
    cropscape: 'Free',
    caltrans: 'Free',
    wqp: 'Free',
    landsat: 'Free',
    sentinel: 'Free',
    dem: 'Free',
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end mb-2">
        <button
          onClick={() => toggleAll(!allEnabled)}
          disabled={toggling !== null}
          className={`
            px-3 py-1.5 text-xs font-medium rounded-md transition-colors
            focus:outline-none focus:ring-2 focus:ring-brand-primary
            ${allEnabled
              ? 'bg-red-600/20 text-red-400 border border-red-600/50 hover:bg-red-600/30'
              : 'bg-green-600/20 text-green-400 border border-green-600/50 hover:bg-green-600/30'
            }
          `}
        >
          {allEnabled ? 'Disable All' : 'Enable All'}
        </button>
      </div>
      {Object.entries(sources).map(([key, source]) => (
        <div key={key} className="flex items-center justify-between py-2 border-b border-border-color last:border-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">
                {SOURCE_LABELS[key] || key}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                SOURCE_COST[key] === 'Free'
                  ? 'bg-green-900/30 text-green-400'
                  : 'bg-yellow-900/30 text-yellow-400'
              }`}>
                {SOURCE_COST[key] || ''}
              </span>
            </div>
            <p className="text-xs text-text-muted truncate">{source.description}</p>
          </div>
          <ToggleSwitch
            id={`source-${key}`}
            checked={source.enabled}
            onChange={(checked) => toggleSource(key, checked)}
            label={`${source.enabled ? 'Disable' : 'Enable'} ${SOURCE_LABELS[key] || key}`}
          />
        </div>
      ))}
    </div>
  );
};

// API Status Component
const ApiStatusIndicator: React.FC = () => {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkStatus = async () => {
    setStatus('checking');
    try {
      const response = await fetch(`${ingestionBaseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      setStatus(response.ok ? 'online' : 'offline');
    } catch {
      setStatus('offline');
    }
    setLastChecked(new Date());
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const statusColors = {
    checking: 'bg-yellow-500',
    online: 'bg-green-500',
    offline: 'bg-red-500',
  };

  const statusText = {
    checking: 'Checking...',
    online: 'Connected',
    offline: 'Disconnected',
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`w-3 h-3 rounded-full ${statusColors[status]} animate-pulse`} />
        <span className="text-sm text-text-primary">{statusText[status]}</span>
        {lastChecked && (
          <span className="text-xs text-text-muted">
            (checked {lastChecked.toLocaleTimeString()})
          </span>
        )}
      </div>
      <button
        onClick={checkStatus}
        disabled={status === 'checking'}
        className="
          px-3 py-1 text-sm bg-brand-bg-dark border border-border-color rounded-md
          hover:bg-brand-bg-lighter transition-colors
          disabled:opacity-50 disabled:cursor-not-allowed
          focus:outline-none focus:ring-2 focus:ring-brand-primary
        "
      >
        Refresh
      </button>
    </div>
  );
};

// Main Settings Component
const SettingsView: React.FC = () => {
  const { 
    preferences, 
    updatePreferences,
    updateDataSettings,
    updateNotifications,
    updateAccessibility,
    updateAnalysis,
    resetPreferences,
    exportPreferences,
    importPreferences,
  } = useUserPreferences();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Theme options
  const themeOptions: { value: Theme; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
  ];

  // Unit options
  const temperatureOptions: { value: TemperatureUnit; label: string }[] = [
    { value: 'fahrenheit', label: '°F (Fahrenheit)' },
    { value: 'celsius', label: '°C (Celsius)' },
  ];

  const windSpeedOptions: { value: WindSpeedUnit; label: string }[] = [
    { value: 'mph', label: 'mph' },
    { value: 'kmh', label: 'km/h' },
    { value: 'ms', label: 'm/s' },
  ];

  const pressureOptions: { value: PressureUnit; label: string }[] = [
    { value: 'inHg', label: 'inHg' },
    { value: 'hPa', label: 'hPa' },
    { value: 'mbar', label: 'mbar' },
  ];

  const refreshIntervalOptions: { value: RefreshInterval; label: string }[] = [
    { value: 5, label: '5 minutes' },
    { value: 15, label: '15 minutes' },
    { value: 30, label: '30 minutes' },
    { value: 60, label: '1 hour' },
    { value: 'manual', label: 'Manual only' },
  ];

  // Accessibility options
  const fontSizeOptions: { value: FontSize; label: string }[] = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
  ];

  const announcementOptions: { value: 'minimal' | 'normal' | 'verbose'; label: string }[] = [
    { value: 'minimal', label: 'Minimal' },
    { value: 'normal', label: 'Normal' },
    { value: 'verbose', label: 'Verbose' },
  ];

  // Analysis options
  const analysisToolOptions: { value: AnalysisTool; label: string }[] = [
    { value: 'quick', label: 'Quick Analysis' },
    { value: 'search', label: 'Web Search' },
    { value: 'maps', label: 'Maps Search' },
    { value: 'deep', label: 'Deep Analysis' },
    { value: 'predictive', label: 'Predictive Analysis' },
    { value: 'weather', label: 'Weather Forecast' },
  ];

  // Date range options
  const dateRangeOptions: { value: number; label: string }[] = [
    { value: 7, label: '7 days' },
    { value: 14, label: '14 days' },
    { value: 30, label: '30 days' },
    { value: 90, label: '90 days' },
  ];

  // Export preferences
  const handleExport = () => {
    const json = exportPreferences();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'geointellisense-settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Import preferences
  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportSuccess(false);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const success = importPreferences(content);
      if (success) {
        setImportSuccess(true);
        setTimeout(() => setImportSuccess(false), 3000);
      } else {
        setImportError('Invalid settings file. Please check the file format.');
      }
    };
    reader.onerror = () => {
      setImportError('Failed to read file.');
    };
    reader.readAsText(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Reset preferences with confirmation
  const handleReset = () => {
    resetPreferences();
    setShowResetConfirm(false);
  };

  // Request notification permission
  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        updateNotifications({ enabled: true });
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3 mb-8">
        <SettingsIcon className="w-8 h-8 text-brand-primary" />
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <p className="text-text-muted">Customize your GeoIntelliSense experience</p>
        </div>
      </div>

      {/* Appearance Section */}
      <SettingsSection 
        title="Appearance" 
        description="Customize the look and feel"
        icon={<SunIcon className="w-5 h-5" />}
      >
        <SettingRow 
          label="Theme" 
          description="Choose your preferred color scheme"
          htmlFor="theme-select"
        >
          <div className="flex items-center gap-2">
            {preferences.theme === 'dark' || (preferences.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) 
              ? <MoonIcon className="w-4 h-4 text-text-muted" /> 
              : <SunIcon className="w-4 h-4 text-text-muted" />
            }
            <Select
              id="theme-select"
              value={preferences.theme}
              onChange={(value) => updatePreferences({ theme: value })}
              options={themeOptions}
            />
          </div>
        </SettingRow>
      </SettingsSection>

      {/* Data & Units Section */}
      <SettingsSection 
        title="Data & Units" 
        description="Configure measurement units and data preferences"
        icon={<GaugeIcon className="w-5 h-5" />}
      >
        <SettingRow 
          label="Temperature Unit" 
          htmlFor="temp-unit"
        >
          <Select
            id="temp-unit"
            value={preferences.dataSettings.temperatureUnit}
            onChange={(value) => updateDataSettings({ temperatureUnit: value })}
            options={temperatureOptions}
          />
        </SettingRow>

        <SettingRow 
          label="Wind Speed Unit" 
          htmlFor="wind-unit"
        >
          <Select
            id="wind-unit"
            value={preferences.dataSettings.windSpeedUnit}
            onChange={(value) => updateDataSettings({ windSpeedUnit: value })}
            options={windSpeedOptions}
          />
        </SettingRow>

        <SettingRow 
          label="Pressure Unit" 
          htmlFor="pressure-unit"
        >
          <Select
            id="pressure-unit"
            value={preferences.dataSettings.pressureUnit}
            onChange={(value) => updateDataSettings({ pressureUnit: value })}
            options={pressureOptions}
          />
        </SettingRow>

        <SettingRow 
          label="Data Refresh Interval" 
          description="How often to automatically refresh data"
          htmlFor="refresh-interval"
        >
          <Select
            id="refresh-interval"
            value={preferences.dataSettings.refreshInterval}
            onChange={(value) => updateDataSettings({ refreshInterval: value as RefreshInterval })}
            options={refreshIntervalOptions}
          />
        </SettingRow>

        <SettingRow 
          label="Default Date Range" 
          description="Default time range for data analysis"
          htmlFor="date-range"
        >
          <Select
            id="date-range"
            value={preferences.dataSettings.defaultDateRangeDays}
            onChange={(value) => updateDataSettings({ defaultDateRangeDays: Number(value) })}
            options={dateRangeOptions}
          />
        </SettingRow>
      </SettingsSection>

      {/* Map Settings Section */}
      <SettingsSection 
        title="Map Settings" 
        description="Configure default map view"
        icon={<MapIcon className="w-5 h-5" />}
      >
        <SettingRow 
          label="Default Zoom Level" 
          htmlFor="map-zoom"
        >
          <Slider
            id="map-zoom"
            value={preferences.mapZoomLevel}
            onChange={(value) => updatePreferences({ mapZoomLevel: value })}
            min={5}
            max={15}
            unit="x"
          />
        </SettingRow>

        <SettingRow 
          label="Expand Sidebar by Default" 
          description="Show sidebar expanded on startup"
          htmlFor="sidebar-expanded"
        >
          <ToggleSwitch
            id="sidebar-expanded"
            checked={preferences.sidebarExpanded}
            onChange={(checked) => updatePreferences({ sidebarExpanded: checked })}
            label="Expand sidebar by default"
          />
        </SettingRow>
      </SettingsSection>

      {/* Notifications Section */}
      <SettingsSection 
        title="Notifications & Alerts" 
        description="Configure environmental alerts"
        icon={<WarningIcon className="w-5 h-5" />}
      >
        <SettingRow 
          label="Enable Notifications" 
          description="Receive alerts for environmental conditions"
          htmlFor="notifications-enabled"
        >
          <div className="flex items-center gap-2">
            {'Notification' in window && Notification.permission === 'denied' && (
              <span className="text-xs text-yellow-500">Blocked by browser</span>
            )}
            <ToggleSwitch
              id="notifications-enabled"
              checked={preferences.notifications.enabled}
              onChange={(checked) => {
                if (checked && 'Notification' in window && Notification.permission === 'default') {
                  requestNotificationPermission();
                } else {
                  updateNotifications({ enabled: checked });
                }
              }}
              label="Enable notifications"
            />
          </div>
        </SettingRow>

        <SettingRow 
          label="AQI Alert Threshold" 
          description="Alert when AQI exceeds this value"
          htmlFor="aqi-threshold"
        >
          <Slider
            id="aqi-threshold"
            value={preferences.notifications.aqiAlertThreshold}
            onChange={(value) => updateNotifications({ aqiAlertThreshold: value })}
            min={50}
            max={300}
            step={10}
          />
        </SettingRow>

        <SettingRow 
          label="High Temperature Alert" 
          description="Alert when temperature exceeds this value"
          htmlFor="temp-high"
        >
          <Slider
            id="temp-high"
            value={preferences.notifications.temperatureAlertHigh}
            onChange={(value) => updateNotifications({ temperatureAlertHigh: value })}
            min={80}
            max={120}
            unit="°"
          />
        </SettingRow>

        <SettingRow 
          label="Low Temperature Alert" 
          description="Alert when temperature drops below this value"
          htmlFor="temp-low"
        >
          <Slider
            id="temp-low"
            value={preferences.notifications.temperatureAlertLow}
            onChange={(value) => updateNotifications({ temperatureAlertLow: value })}
            min={-20}
            max={50}
            unit="°"
          />
        </SettingRow>

        <SettingRow 
          label="Alert Sound" 
          htmlFor="alert-sound"
        >
          <ToggleSwitch
            id="alert-sound"
            checked={preferences.notifications.soundEnabled}
            onChange={(checked) => updateNotifications({ soundEnabled: checked })}
            label="Enable alert sounds"
          />
        </SettingRow>
      </SettingsSection>

      {/* Analysis Section */}
      <SettingsSection 
        title="Analysis Tools" 
        description="Configure analysis preferences"
        icon={<SparklesIcon className="w-5 h-5" />}
      >
        <SettingRow 
          label="Default Analysis Tool" 
          description="Tool to use when opening analysis view"
          htmlFor="default-tool"
        >
          <Select
            id="default-tool"
            value={preferences.analysis.defaultTool}
            onChange={(value) => updateAnalysis({ defaultTool: value })}
            options={analysisToolOptions}
          />
        </SettingRow>

        <SettingRow 
          label="Experimental Features" 
          description="Enable beta features (may be unstable)"
          htmlFor="experimental"
        >
          <ToggleSwitch
            id="experimental"
            checked={preferences.analysis.showExperimentalFeatures}
            onChange={(checked) => updateAnalysis({ showExperimentalFeatures: checked })}
            label="Enable experimental features"
          />
        </SettingRow>
      </SettingsSection>

      {/* Accessibility Section */}
      <SettingsSection 
        title="Accessibility" 
        description="Make GeoIntelliSense work better for you"
        icon={<EyeIcon className="w-5 h-5" />}
      >
        <SettingRow 
          label="Font Size" 
          htmlFor="font-size"
        >
          <Select
            id="font-size"
            value={preferences.accessibility.fontSize}
            onChange={(value) => updateAccessibility({ fontSize: value })}
            options={fontSizeOptions}
          />
        </SettingRow>

        <SettingRow 
          label="Reduced Motion" 
          description="Minimize animations and transitions"
          htmlFor="reduced-motion"
        >
          <ToggleSwitch
            id="reduced-motion"
            checked={preferences.accessibility.reducedMotion}
            onChange={(checked) => updateAccessibility({ reducedMotion: checked })}
            label="Enable reduced motion"
          />
        </SettingRow>

        <SettingRow 
          label="High Contrast" 
          description="Increase contrast for better visibility"
          htmlFor="high-contrast"
        >
          <ToggleSwitch
            id="high-contrast"
            checked={preferences.accessibility.highContrast}
            onChange={(checked) => updateAccessibility({ highContrast: checked })}
            label="Enable high contrast"
          />
        </SettingRow>

        <SettingRow 
          label="Screen Reader Announcements" 
          description="Verbosity of screen reader messages"
          htmlFor="announcements"
        >
          <Select
            id="announcements"
            value={preferences.accessibility.screenReaderAnnouncements}
            onChange={(value) => updateAccessibility({ screenReaderAnnouncements: value })}
            options={announcementOptions}
          />
        </SettingRow>
      </SettingsSection>

      {import.meta.env.DEV && (
        <SettingsSection
          title="Data Sources"
          description="Enable or disable external API data feeds. This admin section is only available in development builds."
          icon={<GaugeIcon className="w-5 h-5" />}
        >
          <DataSourceToggles />
        </SettingsSection>
      )}
      {!import.meta.env.DEV && (
        <SettingsSection
          title="Data Sources"
          description="Administrative source toggles are disabled in production mobile/web builds."
          icon={<GaugeIcon className="w-5 h-5" />}
        />
      )}

      {/* API & Connection Section */}
      <SettingsSection
        title="API & Connection"
        description="Backend server status"
        icon={<KeyIcon className="w-5 h-5" />}
      >
        <SettingRow
          label="Backend Status"
          description="Connection to GeoIntelliSense API server"
        >
          <ApiStatusIndicator />
        </SettingRow>
      </SettingsSection>

      {/* Data Management Section */}
      <SettingsSection 
        title="Data Management" 
        description="Export, import, or reset your settings"
        icon={<LightbulbIcon className="w-5 h-5" />}
      >
        <SettingRow 
          label="Export Settings" 
          description="Download your settings as a JSON file"
        >
          <button
            onClick={handleExport}
            className="
              px-4 py-2 text-sm bg-brand-primary text-white rounded-md
              hover:bg-sky-600 transition-colors
              focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-brand-bg-light
            "
          >
            Export
          </button>
        </SettingRow>

        <SettingRow 
          label="Import Settings" 
          description="Load settings from a JSON file"
        >
          <div className="flex items-center gap-2">
            {importSuccess && (
              <span className="text-sm text-green-500">Imported successfully!</span>
            )}
            {importError && (
              <span className="text-sm text-red-500">{importError}</span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
              id="import-file"
            />
            <label
              htmlFor="import-file"
              className="
                px-4 py-2 text-sm bg-brand-bg-dark border border-border-color rounded-md cursor-pointer
                hover:bg-brand-bg-lighter transition-colors
                focus-within:ring-2 focus-within:ring-brand-primary
              "
            >
              Import
            </label>
          </div>
        </SettingRow>

        <SettingRow 
          label="Reset All Settings" 
          description="Restore all settings to their defaults"
        >
          {showResetConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-yellow-500">Are you sure?</span>
              <button
                onClick={handleReset}
                className="
                  px-3 py-1.5 text-sm bg-red-600 text-white rounded-md
                  hover:bg-red-700 transition-colors
                  focus:outline-none focus:ring-2 focus:ring-red-500
                "
              >
                Yes, Reset
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="
                  px-3 py-1.5 text-sm bg-brand-bg-dark border border-border-color rounded-md
                  hover:bg-brand-bg-lighter transition-colors
                  focus:outline-none focus:ring-2 focus:ring-brand-primary
                "
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="
                px-4 py-2 text-sm bg-red-600/20 text-red-400 border border-red-600/50 rounded-md
                hover:bg-red-600/30 transition-colors
                focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-brand-bg-light
              "
            >
              Reset to Defaults
            </button>
          )}
        </SettingRow>
      </SettingsSection>

      {/* Keyboard Shortcuts Help */}
      <SettingsSection 
        title="Keyboard Shortcuts" 
        description="Quick navigation with your keyboard"
        icon={<LightbulbIcon className="w-5 h-5" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { keys: 'Alt + D', action: 'Go to Dashboard' },
            { keys: 'Alt + M', action: 'Go to Air Quality Map' },
            { keys: 'Alt + E', action: 'Go to Data Explorer' },
            { keys: 'Alt + A', action: 'Go to AI Analysis' },
            { keys: 'Alt + S', action: 'Go to Settings' },
            { keys: 'Shift + ?', action: 'Show shortcuts' },
          ].map(({ keys, action }) => (
            <div key={keys} className="flex items-center justify-between py-2">
              <span className="text-sm text-text-muted">{action}</span>
              <kbd className="px-2 py-1 text-xs font-mono bg-brand-bg-dark border border-border-color rounded">
                {keys}
              </kbd>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
};

export default SettingsView;
