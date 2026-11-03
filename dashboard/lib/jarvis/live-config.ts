import "server-only";
import {
  EndSensitivity,
  Modality,
  StartSensitivity,
  type LiveConnectConfig,
} from "@google/genai";
import { serverEnv } from "@/lib/env";
import { buildSystemInstruction } from "./prompt";
import { toolDeclarations } from "./tools";

/**
 * The full Live config is locked into the ephemeral token server-side, so the
 * browser cannot change the system prompt or add tools.
 */
export function buildLiveConfig(today: string): LiveConnectConfig {
  const voice = serverEnv.liveVoice();
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: buildSystemInstruction(today),
    tools: [{ functionDeclarations: toolDeclarations }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    ...(voice
      ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
      : {}),
    realtimeInputConfig: {
      automaticActivityDetection: {
        // Low start sensitivity: background noise is less likely to count as speech.
        startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
        // High end sensitivity + short silence: answer fast (<2s target).
        endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
        prefixPaddingMs: 200,
        silenceDurationMs: 500,
      },
    },
  };
}
