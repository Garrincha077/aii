import { GoogleGenAI, Modality } from '@google/genai';
import { pcmToWav } from '../utils/audioUtils';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export async function generateSpeechPcm(text: string, voiceName: VoiceName = 'Kore', retries = 3): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error('Failed to generate audio');
      }

      return base64Audio;
    } catch (error: any) {
      const isQuotaError = error.message?.toLowerCase().includes('quota') || error.status === 429;
      if (isQuotaError && attempt < retries - 1) {
        const delayMs = Math.pow(2, attempt) * 5000; // 5s, 10s
        console.warn(`Quota exceeded, retrying in ${delayMs / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to generate speech after multiple retries');
}

export async function generateSpeech(text: string, voiceName: VoiceName = 'Kore'): Promise<string> {
  const base64Audio = await generateSpeechPcm(text, voiceName);
  return pcmToWav(base64Audio, 24000);
}
