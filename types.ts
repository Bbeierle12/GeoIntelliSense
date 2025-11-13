export type ViewType = 'dashboard' | 'chat' | 'analysis' | 'maps';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

// Import GroundingChunk from Google Genai library to ensure type compatibility
export type { GroundingChunk } from '@google/genai';

export type AnalysisTool = 'quick' | 'search' | 'maps' | 'deep' | 'predictive' | 'weather';