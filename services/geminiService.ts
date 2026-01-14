import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

// 1. SMART FORMATTING (Text -> Structured Note)
// Restored the "Secretary" persona to extract actionable data, not just a simple summary.
export const formatTranscription = async (text: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview", // kept your requested model
    contents: `You are an intelligent transcription editor for VocalCanvas. 
    Your goal is to transform raw spoken text into a clean, structured, and useful note.

    Input:
    "${text}"

    Instructions:
    1. Analyze the Intent: Is this a To-Do list, Journal, Brainstorm, or Meeting?
    2. Clarity: Remove filler words (um, uh) for the summary, but keep the core meaning.
    3. Highlights: **Bold** only critical entities (Dates, Times, Locations, Money, Names).

    Output Format (STRICTLY follow this Markdown structure):

    ### [A clean, descriptive Title (3-5 words)]

    **Summary**
    [A concise 1-sentence italicized overview]

    **Key Points**
    * [Point 1]
    * [Point 2]

    **Action Items** (Only if tasks are detected)
    - [ ] [Task 1]
    - [ ] [Task 2]

    **Tags:** #[Category] #[Topic]
    `,
  });

  return response.text || text;
};

// 2. HIGH-FIDELITY TRANSCRIPTION (Audio -> Raw Text)
// Restored the Anti-Hallucination rules. 
// Note: We removed "Summary" from this step because you cannot accurately summarize a stream before it finishes.
export const processAudioFileStream = async (
  base64Data: string, 
  mimeType: string,
  onChunk: (text: string) => void
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContentStream({
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
          text: `You are a high-precision transcription engine.
          Task: Transcribe the audio exactly as spoken.
          
          STRICT ANTI-HALLUCINATION RULES (Environmental Awareness):
          1. **Literal Sounds Only:** Do not guess the source of a sound based on context.
          2. **Descriptive Tags:** Use [THUD], [RUSTLING], [BUMP]. Do NOT use [GAS NOZZLE CLICK] unless you are 100% certain it isn't just a generic noise.
          3. **Ambiguity:** If a sound is unclear, ignore it.
          
          OUTPUT REQUIREMENTS:
          1. TRANSCRIPTION: Be 100% verbatim. Include all filler words.
          2. SOUNDS: Place literal sound descriptions in [brackets].
          3. STREAM: Output text immediately as you hear it.`,
        },
      ],
    },
  });

  let fullText = "";
  for await (const chunk of response) {
    const text = chunk.text;
    if (text) {
      fullText += text;
      onChunk(fullText);
    }
  }

  return fullText;
};

// 3. LIVE SESSION (Real-time Audio)
// Restored the detailed system instruction to prevent live hallucinations.
export const createLiveSession = async (
  onTranscription: (text: string, isFinal: boolean) => void,
  onError: (error: any) => void
) => {
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
      systemInstruction: `
        Transcribe exactly what you hear. 
        RULES FOR SOUNDS:
        1. Be literal. Use [THUD] not [DOOR SLAM] unless certain.
        2. Never guess sounds based on the conversation context. 
        3. If uncertain, ignore the sound.
      `,
    },
  });
};