import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, FlatList, StyleSheet,
  SafeAreaView, RefreshControl,
} from 'react-native';
import JobCard from '../components/JobCard';
import VoiceBar from '../components/VoiceBar';
import { fetchAllJobs } from '../lib/queries';
import { formatDate } from '../lib/status';
import { fs, colors, isWeb } from '../lib/platform';
import type { Job } from '../lib/types';

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const data = await fetchAllJobs();
      setJobs(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  const active  = jobs.filter(j => ['In Progress', 'Scheduled', 'Estimate Scheduled'].includes(j.status)).length;
  const done    = jobs.filter(j => ['Complete', 'Paid'].includes(j.status)).length;
  const pending = jobs.filter(j => ['Needs Billing', 'Invoiced', 'Parts Ordered'].includes(j.status)).length;
  const pipeline = jobs.reduce((sum, j) => sum + (j.value ?? 0), 0);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={isWeb ? styles.webContainer : styles.nativeContainer}>
        <View style={styles.header}>
          <Text style={styles.logo}>
            TMC <Text style={styles.accent}>MECH</Text>
          </Text>
          <View style={styles.headerRight}>
            <Text style={styles.date}>{formatDate(new Date().toISOString())}</Text>
            <View style={styles.notifDot} />
          </View>
        </View>

        <Text style={styles.sub}>FIELD OPS · MONTCO / PHL</Text>

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>TODAY'S PIPELINE</Text>
          <Text style={styles.heroValue}>${pipeline.toLocaleString()}</Text>
          <View style={styles.pills}>
            <Pill label="ACTIVE"  count={active}  color={colors.accent} />
            <Pill label="DONE"    count={done}    color={colors.border} />
            <Pill label="PENDING" count={pending} color={colors.gold} />
          </View>
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>JOBS</Text>
        </View>

        <FlatList
          data={jobs}
          keyExtractor={j => j.id}
          renderItem={({ item }) => <JobCard job={item} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.empty}>// NO JOBS ON DECK</Text>
            ) : null
          }
        />

        <VoiceBar />
      </View>
    </SafeAreaView>
  );
}

function Pill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillCount, { color }]}>{count}</Text>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  nativeContainer: { flex: 1 },
  webContainer: {
    flex: 1,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  logo: {
    fontFamily: 'RussoOne_400Regular',
    fontSize: fs(24),
    color: colors.text,
    letterSpacing: 2,
  },
  accent: { color: colors.accent },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  date: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(13),
    color: colors.muted,
  },
  notifDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  sub: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(11),
    color: colors.muted,
    letterSpacing: 1,
    paddingHorizontal: 16,
    marginTop: 3,
    marginBottom: 14,
  },
  hero: {
    marginHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: 2,
    padding: 16,
    marginBottom: 16,
  },
  heroLabel: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(11),
    color: colors.muted,
    letterSpacing: 2,
    marginBottom: 4,
  },
  heroValue: {
    fontFamily: 'RussoOne_400Regular',
    fontSize: fs(36),
    color: colors.accent,
    marginBottom: 14,
  },
  pills: { flexDirection: 'row', gap: 10 },
  pill: {
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignItems: 'center',
  },
  pillCount: {
    fontFamily: 'RussoOne_400Regular',
    fontSize: fs(18),
  },
  pillLabel: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(10),
    color: colors.muted,
    letterSpacing: 1,
  },
  sectionRow: {
    paddingHorizontal: 16,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 6,
  },
  sectionLabel: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(11),
    color: colors.muted,
    letterSpacing: 2,
  },
  list: { paddingHorizontal: 16, paddingBottom: 8 },
  empty: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(13),
    color: colors.muted,
    textAlign: 'center',
    marginTop: 40,
  },
});
