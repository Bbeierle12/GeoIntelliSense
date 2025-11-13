export type ViewType = 'dashboard' | 'chat' | 'analysis';

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

export type AnalysisTool = 'quick' | 'search' | 'maps' | 'deep' | 'predictive';
