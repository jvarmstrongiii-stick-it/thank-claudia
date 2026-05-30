import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { fs, colors } from '../lib/platform';
import type { OCRResult } from '../lib/api';

interface Props {
  result: OCRResult;
  onSave: (updated: OCRResult) => void;
  onDismiss: () => void;
}

const EQUIPMENT_FIELDS: Array<{ key: keyof OCRResult; label: string }> = [
  { key: 'brand',          label: 'BRAND'       },
  { key: 'model',          label: 'MODEL'       },
  { key: 'serial',         label: 'SERIAL'      },
  { key: 'tonnage',        label: 'TONNAGE'     },
  { key: 'refrigerant',    label: 'REFRIGERANT' },
  { key: 'fuel_type',      label: 'FUEL TYPE'   },
  { key: 'manufacture_year', label: 'YEAR'      },
];

const DOC_FIELDS: Array<{ key: keyof OCRResult; label: string }> = [
  { key: 'customer_name', label: 'CUSTOMER' },
  { key: 'address',       label: 'ADDRESS'  },
  { key: 'description',   label: 'DESC'     },
  { key: 'amount',        label: 'AMOUNT'   },
  { key: 'date',          label: 'DATE'     },
];

export default function OCRResultCard({ result, onSave, onDismiss }: Props) {
  const [data, setData] = useState<OCRResult>(result);

  const isEquipment = data.photo_type === 'equipment';
  const fields = isEquipment ? EQUIPMENT_FIELDS : DOC_FIELDS;

  function set(key: keyof OCRResult, val: string) {
    setData(prev => ({ ...prev, [key]: val || null }));
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>// EXTRACTED</Text>
        <Text style={styles.type}>{data.photo_type?.toUpperCase()}</Text>
      </View>

      {fields.map(({ key, label }) => {
        const val = data[key];
        return (
          <View style={styles.row} key={key}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
              style={styles.input}
              value={val == null ? '' : String(val)}
              onChangeText={t => set(key, t)}
              placeholderTextColor={colors.muted}
              placeholder="—"
            />
          </View>
        );
      })}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss}>
          <Text style={styles.dismissText}>DISCARD</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveBtn} onPress={() => onSave(data)}>
          <Text style={styles.saveText}>SAVE</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 2,
    padding: 12,
    marginTop: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(11),
    color: colors.accent,
    letterSpacing: 1,
  },
  type: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(11),
    color: colors.muted,
    letterSpacing: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  label: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(10),
    color: colors.muted,
    letterSpacing: 1,
    width: 90,
  },
  input: {
    flex: 1,
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(13),
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  dismissBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 2,
    padding: 10,
    alignItems: 'center',
  },
  dismissText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(12),
    color: colors.muted,
    letterSpacing: 1,
  },
  saveBtn: {
    flex: 2,
    backgroundColor: colors.accent,
    borderRadius: 2,
    padding: 10,
    alignItems: 'center',
  },
  saveText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(12),
    color: colors.bg,
    letterSpacing: 2,
  },
});
