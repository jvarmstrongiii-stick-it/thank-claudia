import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { fs, colors } from '../lib/platform';
import { submitVoice, type VoiceResult } from '../lib/api';
import { findCustomerByName, insertCustomer, insertJob } from '../lib/queries';
import ConfirmJobModal from './ConfirmJobModal';

// Speech recognition — only available in dev build (not Expo Go)
let ExpoSpeechRecognitionModule: any = null;
let useSpeechRecognitionEvent: any = null;
try {
  const mod = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = mod.ExpoSpeechRecognitionModule;
  useSpeechRecognitionEvent = mod.useSpeechRecognitionEvent;
} catch {
  // not available (Expo Go or web)
}

const SPEECH_AVAILABLE = !!ExpoSpeechRecognitionModule && Platform.OS !== 'web';

type Mode = 'idle' | 'input' | 'listening' | 'processing' | 'confirming' | 'error';

export default function VoiceBar() {
  const [mode, setMode] = useState<Mode>('idle');
  const [transcript, setTranscript] = useState('');
  const [extracted, setExtracted] = useState<VoiceResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const accumulatedRef = useRef('');

  // Wire speech recognition events (no-ops if not available)
  if (useSpeechRecognitionEvent) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useSpeechRecognitionEvent('result', (event: any) => {
      const text = event.results?.[0]?.transcript ?? '';
      accumulatedRef.current = text;
      setTranscript(text);
    });
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useSpeechRecognitionEvent('end', () => {
      if (accumulatedRef.current.trim()) {
        sendToBackend(accumulatedRef.current.trim());
      } else {
        setMode('idle');
      }
    });
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useSpeechRecognitionEvent('error', (event: any) => {
      setErrorMsg(event.message ?? 'Speech error');
      setMode('error');
    });
  }

  async function startListening() {
    const granted = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted.granted) {
      setErrorMsg('Microphone permission denied');
      setMode('error');
      return;
    }
    accumulatedRef.current = '';
    setTranscript('');
    setMode('listening');
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: false,
    });
  }

  function stopListening() {
    ExpoSpeechRecognitionModule?.stop();
  }

  function handleMicPress() {
    if (mode === 'listening') {
      stopListening();
      return;
    }
    if (mode === 'idle' || mode === 'error') {
      setErrorMsg('');
      if (SPEECH_AVAILABLE) {
        startListening();
      } else {
        setTranscript('');
        setMode('input');
      }
      return;
    }
    if (mode === 'input') {
      setMode('idle');
      setTranscript('');
    }
  }

  async function sendToBackend(text: string) {
    setMode('processing');
    try {
      const result = await submitVoice(text);
      setExtracted(result);
      setMode('confirming');
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Backend error');
      setMode('error');
    }
  }

  async function handleSubmit() {
    const text = transcript.trim();
    if (!text) return;
    await sendToBackend(text);
  }

  const handleConfirm = useCallback(async (data: VoiceResult) => {
    let customerId: string;
    const existing = data.customer_name
      ? await findCustomerByName(data.customer_name)
      : null;

    if (existing) {
      customerId = existing.id;
    } else {
      customerId = await insertCustomer({
        name: data.customer_name!,
        address: data.address,
        phone: data.phone,
      });
    }

    const job = await insertJob({
      customer_id: customerId,
      job_type: data.job_type ?? 'Service Call',
      status: 'Scheduled',
      scheduled_time: data.scheduled_time,
      address: data.address,
      value: data.value,
      notes: data.notes,
    });

    setMode('idle');
    setTranscript('');
    setExtracted(null);
    router.push(`/job/${job.id}`);
  }, []);

  function handleCancel() {
    setMode('idle');
    setExtracted(null);
    setTranscript('');
    setErrorMsg('');
  }

  const isListening  = mode === 'listening';
  const isProcessing = mode === 'processing';
  const isInput      = mode === 'input';

  return (
    <>
      <View style={styles.container}>
        {isInput ? (
          <TextInput
            style={styles.textInput}
            value={transcript}
            onChangeText={setTranscript}
            placeholder="// TYPE JOB DETAILS..."
            placeholderTextColor={colors.muted}
            autoFocus
            multiline={false}
            onSubmitEditing={handleSubmit}
            returnKeyType="send"
          />
        ) : isProcessing ? (
          <View style={styles.status}>
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.statusText}>// PROCESSING...</Text>
          </View>
        ) : mode === 'error' ? (
          <Text style={styles.errorText} numberOfLines={1}>// {errorMsg}</Text>
        ) : (
          <Text style={styles.placeholder}>
            {isListening ? transcript || '// LISTENING_' : '// READY FOR ORDERS_'}
          </Text>
        )}

        <View style={styles.rightSide}>
          {isInput && transcript.trim().length > 0 && (
            <TouchableOpacity style={styles.sendBtn} onPress={handleSubmit}>
              <Text style={styles.sendText}>SEND</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.mic, isListening && styles.micListening, isInput && styles.micActive]}
            activeOpacity={0.7}
            onPress={handleMicPress}
          >
            {isListening
              ? <ActivityIndicator color={colors.bg} size="small" />
              : <Text style={styles.micIcon}>⬤</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {extracted && mode === 'confirming' && (
        <ConfirmJobModal
          visible
          initial={extracted}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  placeholder: {
    flex: 1,
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(14),
    color: colors.muted,
    letterSpacing: 0.5,
  },
  textInput: {
    flex: 1,
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(14),
    color: colors.text,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
  },
  status: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(13),
    color: colors.accent,
    letterSpacing: 1,
  },
  errorText: {
    flex: 1,
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(12),
    color: '#c0392b',
  },
  rightSide: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sendBtn: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sendText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(12),
    color: colors.accent,
    letterSpacing: 1,
  },
  mic: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micActive: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.accent },
  micListening: { backgroundColor: '#c0392b' },
  micIcon: {
    fontSize: fs(14),
    color: colors.bg,
  },
});
