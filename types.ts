
export interface TranscriptionSnippet {
  id: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface AppState {
  isRecording: boolean;
  isProcessing: boolean;
  snippets: TranscriptionSnippet[];
  formattedText: string | null;
  error: string | null;
}
