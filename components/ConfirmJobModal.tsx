import { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { fs, colors } from '../lib/platform';
import type { VoiceResult } from '../lib/api';
import type { JobType } from '../lib/types';

const JOB_TYPES: JobType[] = [
  'Service Call', 'New Install', 'Maintenance', 'Estimate', 'Emergency', 'Custom',
];

interface Props {
  visible: boolean;
  initial: VoiceResult;
  onConfirm: (data: VoiceResult) => Promise<void>;
  onCancel: () => void;
}

export default function ConfirmJobModal({ visible, initial, onConfirm, onCancel }: Props) {
  const [data, setData] = useState<VoiceResult>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when new initial data comes in
  if (JSON.stringify(initial) !== JSON.stringify(data) && !saving) {
    // only reset if modal just opened
  }

  function field(key: keyof VoiceResult, label: string, required = false) {
    const val = data[key];
    const strVal = val == null ? '' : String(val);
    return (
      <View style={styles.field} key={key}>
        <Text style={styles.fieldLabel}>
          {label}{required && !strVal ? <Text style={styles.required}> *</Text> : null}
        </Text>
        <TextInput
          style={[styles.input, required && !strVal && styles.inputRequired]}
          value={strVal}
          onChangeText={t => setData(prev => ({ ...prev, [key]: t || null }))}
          placeholderTextColor={colors.muted}
          placeholder={required ? 'REQUIRED' : '—'}
        />
      </View>
    );
  }

  async function handleSave() {
    if (!data.customer_name || !data.job_type) {
      setError('Customer name and job type are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(data);
    } catch (e: any) {
      setError(e.message ?? 'Save failed');
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide">
      <TouchableOpacity style={styles.overlay} onPress={onCancel} />
      <View style={styles.sheet}>
        <Text style={styles.title}>CONFIRM JOB</Text>
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          {field('customer_name', 'CUSTOMER', true)}
          {field('address', 'ADDRESS')}
          {field('phone', 'PHONE')}

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>JOB TYPE <Text style={styles.required}>*</Text></Text>
            <View style={styles.typeRow}>
              {JOB_TYPES.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeBtn, data.job_type === t && styles.typeBtnActive]}
                  onPress={() => setData(prev => ({ ...prev, job_type: t }))}
                >
                  <Text style={[styles.typeBtnText, data.job_type === t && styles.typeBtnTextActive]}>
                    {t.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {field('scheduled_time', 'TIME (ISO)')}
          {field('value', 'VALUE ($)')}
          {field('notes', 'NOTES')}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelText}>CANCEL</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
            {saving
              ? <ActivityIndicator color={colors.bg} />
              : <Text style={styles.saveText}>SAVE JOB</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    maxHeight: '80%',
  },
  title: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(12),
    color: colors.muted,
    letterSpacing: 2,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scroll: { paddingHorizontal: 16 },
  field: { marginTop: 12 },
  fieldLabel: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(11),
    color: colors.muted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  required: { color: colors.accent },
  input: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(14),
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 2,
    padding: 10,
    backgroundColor: colors.surface2,
  },
  inputRequired: { borderColor: colors.accent },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  typeBtnActive: { borderColor: colors.accent, backgroundColor: colors.surface2 },
  typeBtnText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(10),
    color: colors.muted,
    letterSpacing: 1,
  },
  typeBtnTextActive: { color: colors.accent },
  errorText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(12),
    color: '#c0392b',
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 2,
    padding: 14,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(13),
    color: colors.muted,
    letterSpacing: 1,
  },
  saveBtn: {
    flex: 2,
    backgroundColor: colors.accent,
    borderRadius: 2,
    padding: 14,
    alignItems: 'center',
  },
  saveText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(13),
    color: colors.bg,
    letterSpacing: 2,
  },
});
