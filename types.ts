export type ViewType = 'dashboard' | 'air-quality-map' | 'analysis' | 'settings';

export type TemperatureUnit = 'fahrenheit' | 'celsius';
export type WindSpeedUnit = 'mph' | 'kmh' | 'ms';
export type PressureUnit = 'inHg' | 'hPa' | 'mbar';
export type FontSize = 'small' | 'medium' | 'large';
export type RefreshInterval = 5 | 15 | 30 | 60 | 'manual';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
  maps?: {
    uri: string;
    title: string;
    placeAnswerSources?: {
        reviewSnippets: {
            uri: string;
            text: string;
            author: string;
        }[]
    }
  }
}

export type AnalysisTool = 'quick' | 'search' | 'maps' | 'deep' | 'predictive' | 'weather';