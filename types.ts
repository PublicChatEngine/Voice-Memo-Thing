
export interface TranscriptionSnippet {
  id: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface RecordingSession {
  id: string;
  name: string;
  snippets: TranscriptionSnippet[];
  formattedText: string | null;
  status: 'idle' | 'transcribing' | 'formatting' | 'completed' | 'error';
  timestamp: number;
  lastEdited: number;
}

export interface AppState {
  isRecording: boolean;
  sessions: RecordingSession[];
  activeSessionId: string | null;
  error: string | null;
}
