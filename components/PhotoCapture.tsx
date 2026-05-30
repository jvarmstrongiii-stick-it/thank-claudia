import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { submitOCR } from '../lib/api';
import { insertJobPhoto, upsertEquipment } from '../lib/queries';
import { fs, colors } from '../lib/platform';
import type { OCRResult } from '../lib/api';
import OCRResultCard from './OCRResultCard';

interface Props {
  jobId: string;
  customerId: string;
  onDone: () => void;
}

type State = 'idle' | 'uploading' | 'reading' | 'extracted' | 'error';

export default function PhotoCapture({ jobId, customerId, onDone }: Props) {
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [storagePath, setStoragePath] = useState('');

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setErrorMsg('Camera roll permission denied');
      setState('error');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      base64: true,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    await processImage(asset.base64!, asset.mimeType ?? 'image/jpeg', asset.uri);
  }

  async function processImage(base64: string, mimeType: string, uri: string) {
    setState('uploading');
    try {
      // Upload to Supabase Storage
      const path = `job-photos/${jobId}/${Date.now()}.jpg`;
      const byteArray = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const { error: uploadError } = await supabase.storage
        .from('job-photos')
        .upload(path, byteArray, { contentType: mimeType, upsert: false });
      if (uploadError) throw uploadError;
      setStoragePath(path);

      // OCR via backend
      setState('reading');
      const result = await submitOCR(base64, mimeType, jobId);
      setOcrResult(result);
      setState('extracted');
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Processing failed');
      setState('error');
    }
  }

  async function handleSaveOCR(updated: OCRResult) {
    if (!ocrResult) return;
    try {
      const photoType = updated.photo_type ?? 'other';
      await insertJobPhoto({
        job_id: jobId,
        storage_path: storagePath,
        photo_type: photoType,
        ocr_data: updated as unknown as Record<string, unknown>,
      });

      if (photoType === 'equipment') {
        await upsertEquipment(customerId, jobId, {
          brand: updated.brand,
          model: updated.model,
          serial: updated.serial,
          tonnage: updated.tonnage,
          refrigerant: updated.refrigerant,
          fuel_type: updated.fuel_type as any,
          manufacture_year: updated.manufacture_year,
        });
      }

      setOcrResult(null);
      setState('idle');
      onDone();
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Save failed');
      setState('error');
    }
  }

  const statusLabel =
    state === 'uploading' ? '// UPLOADING...' :
    state === 'reading'   ? '// READING...'   :
    state === 'error'     ? `// ${errorMsg}`  : null;

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <TouchableOpacity
          style={[styles.addBtn, (state === 'uploading' || state === 'reading') && styles.disabled]}
          onPress={pickImage}
          disabled={state === 'uploading' || state === 'reading'}
        >
          {state === 'uploading' || state === 'reading'
            ? <ActivityIndicator color={colors.bg} size="small" />
            : <Text style={styles.addBtnText}>+ PHOTO</Text>}
        </TouchableOpacity>
        {statusLabel && (
          <Text style={[styles.status, state === 'error' && styles.statusError]}>
            {statusLabel}
          </Text>
        )}
      </View>

      {ocrResult && state === 'extracted' && (
        <OCRResultCard
          result={ocrResult}
          onSave={handleSaveOCR}
          onDismiss={() => { setOcrResult(null); setState('idle'); onDone(); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addBtn: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 90,
    alignItems: 'center',
  },
  disabled: { borderColor: colors.border, opacity: 0.5 },
  addBtnText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(12),
    color: colors.accent,
    letterSpacing: 1,
  },
  status: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(12),
    color: colors.muted,
    letterSpacing: 1,
  },
  statusError: { color: '#c0392b' },
});
