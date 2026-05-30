import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import type { Job } from '../lib/types';
import { STATUS_LABELS, STATUS_COLORS, formatTime } from '../lib/status';
import { fs, colors } from '../lib/platform';

export default function JobCard({ job }: { job: Job }) {
  const statusLabel = STATUS_LABELS[job.status] ?? job.status;
  const borderColor = STATUS_COLORS[job.status] ?? colors.border;
  const nameParts = job.customer.name.split(',');
  const displayName = nameParts.length > 1
    ? `${nameParts[0].trim()}, ${nameParts[1].trim().charAt(0)}.`
    : job.customer.name;

  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: borderColor }]}
      onPress={() => router.push(`/job/${job.id}`)}
      activeOpacity={0.75}
    >
      <View style={styles.row}>
        <Text style={styles.name}>{displayName}</Text>
        <Text style={styles.time}>{formatTime(job.scheduled_time)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.type}>{job.job_type.toUpperCase()}</Text>
        {job.value != null && job.value > 0 && (
          <Text style={styles.value}>${job.value.toLocaleString()}</Text>
        )}
      </View>
      <View style={styles.row}>
        <Text style={styles.address} numberOfLines={1}>
          {job.address ?? job.customer.address ?? '—'}
        </Text>
        <Text style={[styles.status, { color: borderColor }]}>{statusLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderLeftWidth: 2,
    borderRadius: 2,
    padding: 14,
    marginBottom: 8,
    gap: 5,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontFamily: 'Barlow_600SemiBold',
    fontSize: fs(16),
    color: colors.text,
  },
  time: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(15),
    color: colors.gold,
  },
  type: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(11),
    color: colors.muted,
    letterSpacing: 1,
  },
  value: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(13),
    color: colors.text,
  },
  address: {
    fontFamily: 'Barlow_400Regular',
    fontSize: fs(13),
    color: colors.muted,
    flex: 1,
    marginRight: 8,
  },
  status: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(11),
    letterSpacing: 1,
  },
});
