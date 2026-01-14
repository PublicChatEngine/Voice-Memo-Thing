
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

export const formatTranscription = async (text: string): Promise<string> => {
  // Create a new GoogleGenAI instance right before making an API call to ensure it uses the latest API key.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are a professional scribe. 
    Task: Format the raw transcription below into a beautiful, readable document.
    
    STRICT RULES:
    1. VERBATIM: Do not change, remove, or summarize a single spoken word.
    2. SOUNDS: Keep all [bracketed background sounds] exactly where they are.
    3. STRUCTURE: Use paragraphs and bullet points for lists. Use bold for key names or terms.
    4. NO CHAT: Provide ONLY the formatted text. No intro/outro.
    5. TITLE: Add a simple bold title at the start based on the context.

    RAW TEXT:
    ${text}`,
  });

  return response.text || text;
};

export const transcribeAudioFile = async (base64Data: string, mimeType: string): Promise<string> => {
  // Create a new GoogleGenAI instance right before making an API call.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Switched to gemini-3-flash-preview for significantly faster processing
  // Fix: Corrected contents structure to use { parts: [...] } as per SDK guidelines for multimodal requests.
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        },
        {
          text: `Transcribe this audio file exactly as spoken. 
          Note background noises in brackets [like this]. 
          Be 100% verbatim. Do not skip any filler words or sounds.`,
        },
      ],
    },
  });

  return response.text || "";
};

export const createLiveSession = async (
  onTranscription: (text: string, isFinal: boolean) => void,
  onError: (error: any) => void
) => {
  // Create a new GoogleGenAI instance right before making an API call.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks: {
      onopen: () => {
        console.debug('Live session opened');
      },
      onmessage: async (message: LiveServerMessage) => {
        if (message.serverContent?.inputTranscription) {
          onTranscription(message.serverContent.inputTranscription.text, !!message.serverContent.turnComplete);
        }
        
        const base64EncodedAudioString = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (base64EncodedAudioString) {
          console.debug('Received audio output chunk');
        }
      },
      onerror: (e) => {
        console.error('Live session error:', e);
        onError(e);
      },
      onclose: () => {
        console.debug('Live session closed');
      },
    },
    config: {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      systemInstruction: "Transcribe exactly what you hear. Put all non-speech sounds in [brackets]. Be precise and verbatim.",
    },
  });
};
