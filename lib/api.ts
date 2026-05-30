import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Override via app.json extra.backendUrl for device builds
const BACKEND: string =
  (Constants.expoConfig?.extra?.backendUrl as string | undefined) ??
  (Platform.OS === 'web' ? 'http://localhost:3001' : 'http://localhost:3001');

export interface VoiceResult {
  customer_name: string | null;
  address: string | null;
  phone: string | null;
  job_type: string | null;
  scheduled_time: string | null;
  value: number | null;
  notes: string | null;
  missing_fields: string[];
}

export interface OCRResult {
  photo_type: 'equipment' | 'estimate' | 'invoice' | 'other';
  // equipment fields
  brand?: string | null;
  model?: string | null;
  serial?: string | null;
  tonnage?: string | null;
  refrigerant?: string | null;
  fuel_type?: 'gas' | 'electric' | 'oil' | null;
  manufacture_year?: number | null;
  // estimate/invoice fields
  customer_name?: string | null;
  address?: string | null;
  amount?: number | null;
  date?: string | null;
  description?: string | null;
  additional?: string | null;
  jobId?: string;
}

export async function submitVoice(transcript: string): Promise<VoiceResult> {
  const res = await fetch(`${BACKEND}/api/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? `Voice API error ${res.status}`);
  }
  return res.json();
}

export async function submitOCR(
  base64: string,
  mimeType: string,
  jobId: string,
): Promise<OCRResult> {
  const res = await fetch(`${BACKEND}/api/ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64, mimeType, jobId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? `OCR API error ${res.status}`);
  }
  return res.json();
}
