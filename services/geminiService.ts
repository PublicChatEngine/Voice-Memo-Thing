
import { GoogleGenAI, Modality } from "@google/genai";

const API_KEY = process.env.API_KEY || "";

export const formatTranscription = async (text: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are a professional editor. I will provide a raw transcription with background noises in brackets.
    YOUR TASK:
    1. Organize the text into logical paragraphs or bullet points for readability.
    2. Use bolding for emphasis on key points or speakers.
    3. KEEP THE TEXT INTACT. DO NOT change, remove, or summarize the spoken words. Every word must remain exactly as spoken.
    4. ENSURE BACKGROUND NOISES (e.g., [door slams], [birds]) are preserved in their original locations within the text.
    5. Do not add any introductory or concluding remarks. Just output the formatted text.

    RAW TEXT:
    ${text}`,
  });

  return response.text || text;
};

export const transcribeAudioFile = async (base64Data: string, mimeType: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType,
        },
      },
      {
        text: `Transcribe this audio file exactly as it sounds. 
        CRITICAL: Include background noises and environmental sounds in brackets, such as [keyboard typing], [siren wails], [laughter], [dog barking], or [door opening]. 
        Do not skip any words or background events. 
        Keep the transcription verbatim.`,
      },
    ],
  });

  return response.text || "";
};

export const createLiveSession = async (
  onTranscription: (text: string, isFinal: boolean) => void,
  onError: (error: any) => void
) => {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks: {
      onopen: () => console.log("Live session opened"),
      onmessage: async (message) => {
        if (message.serverContent?.inputTranscription) {
          const text = message.serverContent.inputTranscription.text;
          onTranscription(text, !!message.serverContent.turnComplete);
        }
      },
      onerror: (e) => {
        console.error("Live session error:", e);
        onError(e);
      },
      onclose: () => console.log("Live session closed"),
    },
    config: {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      systemInstruction: `You are an intelligent transcription editor for a voice note app called VocalCanvas. Your goal is to transform raw, unstructured spoken text into a clean, formatted, and useful note.

Input:
A raw transcript of a user's voice note.

Instructions:
1. Analyze the Intent: Determine if the note is a To-Do list, a Journal Entry, an Idea/Brainstorm, or a Meeting Note.
2. Structure the Output: Use Markdown formatting to organize the content.
3. Clarity: Remove filler words (um, uh, like) and fix grammar, but preserve the user's specific tone and vocabulary.
4. Highlights: Use **bold** ONLY for critical entities: Dates, Times, Locations, Money, or specific Names. Do not bold generic phrases.

Output Format (strictly follow this Markdown structure):

### [A short, 3-5 word summary title of the note]

**Summary**
[A concise 1-2 sentence overview of what was said]

**Key Points**
* [Point 1]
* [Point 2]

**Action Items** (Only include if tasks are detected)
- [ ] [Task 1]
- [ ] [Task 2]

**Tags:** #[Category] #[Topic]
 
      CRITICAL: Always include background noises and environmental sounds in brackets, such as [keyboard typing], [siren wails], [laughter], [dog barking], or [door opening]. 
      Do not skip any words or background events.`,
    },
  });
};
