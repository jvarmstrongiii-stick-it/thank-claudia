import { View, Text, StyleSheet } from 'react-native';
import { fs, colors } from '../lib/platform';
import type { Equipment } from '../lib/types';

interface Props {
  equipment: Equipment;
  onFile?: boolean;
}

export default function EquipmentCard({ equipment: e, onFile }: Props) {
  const age = e.manufacture_year
    ? `${new Date().getFullYear() - e.manufacture_year} YRS`
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.brand}>{(e.brand ?? 'UNKNOWN').toUpperCase()}</Text>
        {onFile && <Text style={styles.onFile}>// UNIT ON FILE</Text>}
      </View>

      <View style={styles.grid}>
        {e.model    && <Chip label="MODEL"  value={e.model} />}
        {e.serial   && <Chip label="SERIAL" value={e.serial} />}
        {e.tonnage  && <Chip label="TONS"   value={e.tonnage} />}
        {e.refrigerant && <Chip label="REF" value={e.refrigerant} />}
        {e.fuel_type   && <Chip label="FUEL" value={e.fuel_type.toUpperCase()} />}
        {age           && <Chip label="AGE"  value={age} />}
        {e.condition   && <Chip label="COND" value={e.condition.toUpperCase()} />}
      </View>

      {e.notes ? <Text style={styles.notes}>{e.notes}</Text> : null}
    </View>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={styles.chipValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 2,
    padding: 12,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  brand: {
    fontFamily: 'RussoOne_400Regular',
    fontSize: fs(16),
    color: colors.text,
    letterSpacing: 1,
  },
  onFile: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(10),
    color: colors.accent,
    letterSpacing: 1,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipLabel: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(9),
    color: colors.muted,
    letterSpacing: 1,
  },
  chipValue: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(12),
    color: colors.text,
  },
  notes: {
    fontFamily: 'Barlow_400Regular',
    fontSize: fs(13),
    color: colors.muted,
    marginTop: 8,
  },
});
