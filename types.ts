export enum AppMode {
  LIVE = 'LIVE',
  TRANSCRIBE = 'TRANSCRIBE',
  FAST_CHAT = 'FAST_CHAT'
}

export interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: Date;
}

export interface TranscribeResult {
  text: string;
  isProcessing: boolean;
}
