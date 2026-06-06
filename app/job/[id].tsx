import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Linking, SafeAreaView, Modal,
  FlatList, ActivityIndicator, Platform, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { fetchJob, updateJobStatus, updateJobTime, updateJobAddress, fetchCustomerHistory, fetchJobPhotos, fetchEquipmentForJob, fetchChores, insertChore, toggleChore } from '../../lib/queries';
import { STATUS_LABELS, STATUS_COLORS, statusesForJobType, formatTime, formatDate } from '../../lib/status';
import { fs, colors } from '../../lib/platform';
import type { Job, JobStatus, Equipment, JobPhoto, Chore } from '../../lib/types';
import PhotoCapture from '../../components/PhotoCapture';
import PhotoStrip from '../../components/PhotoStrip';
import EquipmentCard from '../../components/EquipmentCard';

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [history, setHistory] = useState<Job[]>([]);
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [newChore, setNewChore] = useState('');
  const [loading, setLoading] = useState(true);
  const [statusModal, setStatusModal] = useState(false);
  const [rescheduleModal, setRescheduleModal] = useState(false);
  const [addressModal, setAddressModal] = useState(false);
  const [editAddress, setEditAddress] = useState('');
  const [locating, setLocating] = useState(false);
  const [pickedDate, setPickedDate] = useState<Date>(new Date());
  const [pickerStep, setPickerStep] = useState<'date' | 'time' | 'done'>('date');
  const [webDateStr, setWebDateStr] = useState('');
  const [webTimeStr, setWebTimeStr] = useState('');
  const insets = useSafeAreaInsets();

  async function load() {
    try {
      const data = await fetchJob(id);
      setJob(data);
      if (data) {
        const [hist, pics, equip, tasks] = await Promise.all([
          fetchCustomerHistory(data.customer_id, id),
          fetchJobPhotos(id),
          fetchEquipmentForJob(id),
          fetchChores(id),
        ]);
        setHistory(hist);
        setPhotos(pics);
        setEquipment(equip);
        setChores(tasks);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function handleAddChore() {
    const text = newChore.trim();
    if (!text || !job) return;
    setNewChore('');
    const chore = await insertChore(job.id, text, job.customer_id);
    setChores(prev => [...prev, chore]);
  }

  async function handleToggleChore(chore: Chore) {
    const next = chore.status === 'open' ? 'done' : 'open';
    setChores(prev => prev.map(c => c.id === chore.id ? { ...c, status: next } : c));
    await toggleChore(chore.id, next);
  }

  async function handleStatusChange(status: JobStatus) {
    if (!job) return;
    setStatusModal(false);
    await updateJobStatus(job.id, status);
    setJob({ ...job, status });
  }

  function openAddressEdit() {
    setEditAddress(address ?? '');
    setAddressModal(true);
  }

  async function handleLocate() {
    if (!navigator?.geolocation) return;
    setLocating(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      );
      const { latitude, longitude } = pos.coords;
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
        { headers: { 'User-Agent': 'TMC-Mechanical-App/1.0' } }
      );
      const json = await resp.json();
      const a = json.address ?? {};
      const formatted = [
        a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road,
        a.city ?? a.town ?? a.village,
        a.state,
        a.postcode,
      ].filter(Boolean).join(', ');
      setEditAddress(formatted || json.display_name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
    } catch {
      // user can type manually
    } finally {
      setLocating(false);
    }
  }

  async function handleSaveAddress() {
    if (!job) return;
    const addr = editAddress.trim();
    if (!addr) return;
    setAddressModal(false);
    await updateJobAddress(job.id, addr);
    setJob({ ...job, address: addr });
  }

  function openReschedule() {
    const base = job?.scheduled_time ? new Date(job.scheduled_time) : new Date();
    setPickedDate(base);
    setPickerStep('date');
    const d = base.toISOString().slice(0, 10);
    const t = base.toTimeString().slice(0, 5);
    setWebDateStr(d);
    setWebTimeStr(t);
    setRescheduleModal(true);
  }

  async function handleReschedule(finalDate?: Date) {
    if (!job) return;
    let newDate: Date;
    if (Platform.OS === 'web') {
      newDate = new Date(`${webDateStr}T${webTimeStr}`);
    } else {
      newDate = finalDate ?? pickedDate;
    }
    setRescheduleModal(false);
    setPickerStep('date');
    await updateJobTime(job.id, newDate.toISOString());
    setJob({ ...job, scheduled_time: newDate.toISOString() });
  }

  function onNativeDateChange(_: any, date?: Date) {
    if (!date) { setRescheduleModal(false); setPickerStep('date'); return; }
    if (pickerStep === 'date') {
      setPickedDate(date);
      setPickerStep('time');
    } else {
      handleReschedule(date);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#8fba3c" />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>// JOB NOT FOUND</Text>
      </View>
    );
  }

  const NOTES_SEP = '\n\n---\n\n';
  function parseNotes(raw: string | null): [string, string] {
    if (!raw) return ['', ''];
    const idx = raw.indexOf(NOTES_SEP);
    if (idx === -1) return [raw, ''];
    return [raw.slice(0, idx), raw.slice(idx + NOTES_SEP.length)];
  }

  const statusLabel = STATUS_LABELS[job.status] ?? job.status;
  const statusColor = STATUS_COLORS[job.status] ?? '#2a2b22';
  const address = job.address ?? job.customer.address;
  const [originalAsk, additionalComments] = parseNotes(job.notes);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← JOBS</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.customerName}>{job.customer.name}</Text>
        <View style={styles.jobTypeLine}>
          <Text style={styles.jobType}>{job.job_type.toUpperCase()}</Text>
          {!!originalAsk && (
            <Text style={styles.jobAsk} numberOfLines={1}> · {originalAsk}</Text>
          )}
        </View>

        <View style={styles.divider} />

        <Row label="STATUS">
          <TouchableOpacity onPress={() => setStatusModal(true)}>
            <Text style={[styles.statusBadge, { color: statusColor, borderColor: statusColor }]}>
              {statusLabel}
            </Text>
          </TouchableOpacity>
        </Row>

        <Row label="SCHEDULED">
          <TouchableOpacity onPress={openReschedule}>
            <Text style={[styles.value, styles.link]}>
              {formatDate(job.scheduled_time)}{'  '}{formatTime(job.scheduled_time)}
            </Text>
          </TouchableOpacity>
        </Row>

        {job.value != null && job.value > 0 && (
          <Row label="VALUE">
            <Text style={styles.value}>${job.value.toLocaleString()}</Text>
          </Row>
        )}

        <Row label="ADDRESS">
          <TouchableOpacity onPress={openAddressEdit}>
            {address
              ? <Text style={[styles.value, styles.link]}>{address}</Text>
              : <Text style={[styles.value, { color: colors.muted }]}>// TAP TO SET</Text>
            }
          </TouchableOpacity>
        </Row>

        {job.customer.phone && (
          <Row label="PHONE">
            <TouchableOpacity onPress={() => Linking.openURL(`tel:${job.customer.phone}`)}>
              <Text style={[styles.value, styles.link]}>{job.customer.phone}</Text>
            </TouchableOpacity>
          </Row>
        )}

        {(originalAsk || additionalComments) && (
          <>
            <View style={styles.divider} />
            {!!originalAsk && (
              <>
                <Text style={styles.sectionLabel}>ORIGINAL ASK</Text>
                <Text style={styles.notes}>{originalAsk}</Text>
              </>
            )}
            {!!additionalComments && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 12 }]}>ADDITIONAL COMMENTS</Text>
                <Text style={styles.notes}>{additionalComments}</Text>
              </>
            )}
          </>
        )}

        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>CHORES</Text>
        {chores.map(chore => (
          <TouchableOpacity
            key={chore.id}
            style={styles.choreRow}
            onPress={() => handleToggleChore(chore)}
            activeOpacity={0.7}
          >
            <View style={[styles.choreCheck, chore.status === 'done' && styles.choreCheckDone]}>
              {chore.status === 'done' && <Text style={styles.choreCheckMark}>✓</Text>}
            </View>
            <View style={styles.choreTextWrap}>
              <Text style={[styles.choreText, chore.status === 'done' && styles.choreTextDone]}>
                {chore.description}
              </Text>
              {chore.assignee?.name && (
                <Text style={styles.choreAssignee}>{chore.assignee.name}</Text>
              )}
            </View>
          </TouchableOpacity>
        ))}
        <View style={styles.choreInputRow}>
          <TextInput
            style={styles.choreInput}
            value={newChore}
            onChangeText={setNewChore}
            placeholder="// ADD CHORE..."
            placeholderTextColor={colors.muted}
            onSubmitEditing={handleAddChore}
            returnKeyType="done"
          />
          <TouchableOpacity
            style={[styles.choreAddBtn, !newChore.trim() && styles.choreAddBtnDisabled]}
            onPress={handleAddChore}
            disabled={!newChore.trim()}
          >
            <Text style={styles.choreAddBtnText}>ADD</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>PHOTOS</Text>
        <PhotoStrip photos={photos} />
        <PhotoCapture
          jobId={job.id}
          customerId={job.customer_id}
          onDone={load}
        />

        {equipment.length > 0 && (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>EQUIPMENT</Text>
            {equipment.map(e => (
              <EquipmentCard key={e.id} equipment={e} />
            ))}
          </>
        )}

        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>SERVICE HISTORY</Text>
        {history.length === 0 ? (
          <Text style={styles.empty}>// FIRST JOB FOR THIS CUSTOMER</Text>
        ) : (
          history.map(h => (
            <TouchableOpacity
              key={h.id}
              style={styles.historyRow}
              onPress={() => router.replace(`/job/${h.id}`)}
            >
              <View style={styles.historyLeft}>
                <Text style={styles.historyType}>{h.job_type}</Text>
                <Text style={styles.historyDate}>{formatDate(h.scheduled_time)}</Text>
              </View>
              <Text style={[styles.historyStatus, { color: STATUS_COLORS[h.status] }]}>
                {STATUS_LABELS[h.status]}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Android: bare native dialogs, no sheet needed */}
      {Platform.OS === 'android' && rescheduleModal && (
        <DateTimePicker
          value={pickedDate}
          mode={pickerStep === 'time' ? 'time' : 'date'}
          display="default"
          is24Hour
          onChange={onNativeDateChange}
        />
      )}

      {/* iOS + web: bottom sheet */}
      {Platform.OS !== 'android' && (
        <Modal visible={rescheduleModal} transparent animationType="slide">
          <TouchableOpacity style={styles.overlay} onPress={() => setRescheduleModal(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>RESCHEDULE</Text>
            {Platform.OS === 'web' ? (
              <>
                <View style={styles.webPickerRow}>
                  <TextInput
                    style={styles.webInput}
                    value={webDateStr}
                    onChangeText={setWebDateStr}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.muted}
                  />
                  <TextInput
                    style={styles.webInput}
                    value={webTimeStr}
                    onChangeText={setWebTimeStr}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.muted}
                  />
                </View>
                <TouchableOpacity style={styles.saveBtn} onPress={() => handleReschedule()}>
                  <Text style={styles.saveBtnText}>CONFIRM</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.pickerStepLabel}>
                  {pickerStep === 'time' ? 'TIME' : 'DATE'}
                </Text>
                <DateTimePicker
                  value={pickedDate}
                  mode={pickerStep === 'time' ? 'time' : 'date'}
                  display="spinner"
                  is24Hour
                  themeVariant="dark"
                  onChange={onNativeDateChange}
                  style={styles.picker}
                />
              </>
            )}
          </View>
        </Modal>
      )}

      <Modal visible={addressModal} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} onPress={() => setAddressModal(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>JOB ADDRESS</Text>
          <View style={{ padding: 16 }}>
            <TextInput
              style={[styles.webInput, { minHeight: 52, textAlignVertical: 'top', marginBottom: 10 }]}
              value={editAddress}
              onChangeText={setEditAddress}
              placeholder="Street address..."
              placeholderTextColor={colors.muted}
              multiline
              autoFocus
            />
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.border, marginBottom: 8 }]}
              onPress={handleLocate}
              disabled={locating}
            >
              {locating
                ? <ActivityIndicator color={colors.text} size="small" />
                : <Text style={[styles.saveBtnText, { color: colors.text }]}>USE MY LOCATION</Text>
              }
            </TouchableOpacity>
            {!!editAddress.trim() && !!address && (
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: colors.surface2, marginBottom: 8 }]}
                onPress={() => {
                  const encoded = encodeURIComponent(address);
                  const url = Platform.OS === 'ios'
                    ? `maps://?q=${encoded}`
                    : `https://maps.google.com/maps?q=${encoded}`;
                  Linking.openURL(url);
                }}
              >
                <Text style={[styles.saveBtnText, { color: colors.muted }]}>NAVIGATE</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.saveBtn, !editAddress.trim() && styles.choreAddBtnDisabled]}
              onPress={handleSaveAddress}
              disabled={!editAddress.trim()}
            >
              <Text style={styles.saveBtnText}>SAVE ADDRESS</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={statusModal} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} onPress={() => setStatusModal(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>SET STATUS</Text>
          <FlatList
            data={statusesForJobType(job.job_type)}
            keyExtractor={s => s}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.statusOption, job.status === item && styles.statusOptionActive]}
                onPress={() => handleStatusChange(item)}
              >
                <Text style={[styles.statusOptionText, { color: colors.text }]}>
                  {item}
                </Text>
                <Text style={[styles.statusOptionSub, { color: STATUS_COLORS[item] }]}>
                  {STATUS_LABELS[item]}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  topBar: { paddingHorizontal: 16, paddingBottom: 4 },
  backBtn: { alignSelf: 'flex-start' },
  backText: { fontFamily: 'ShareTechMono_400Regular', fontSize: fs(13), color: colors.accent, letterSpacing: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  customerName: { fontFamily: 'RussoOne_400Regular', fontSize: fs(26), color: colors.text, marginTop: 8 },
  jobTypeLine: { flexDirection: 'row', alignItems: 'center', marginTop: 4, overflow: 'hidden' },
  jobType: { fontFamily: 'ShareTechMono_400Regular', fontSize: fs(12), color: colors.muted, letterSpacing: 2, flexShrink: 0 },
  jobAsk: { fontFamily: 'Barlow_400Regular', fontSize: fs(12), color: colors.muted, flex: 1 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  label: { fontFamily: 'ShareTechMono_400Regular', fontSize: fs(12), color: colors.muted, letterSpacing: 1 },
  value: { fontFamily: 'ShareTechMono_400Regular', fontSize: fs(14), color: colors.text },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  statusBadge: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(13),
    letterSpacing: 1,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 2,
  },
  sectionLabel: { fontFamily: 'ShareTechMono_400Regular', fontSize: fs(12), color: colors.muted, letterSpacing: 2, marginBottom: 8 },
  notes: { fontFamily: 'Barlow_400Regular', fontSize: fs(15), color: colors.text, lineHeight: fs(22) },
  empty: { fontFamily: 'ShareTechMono_400Regular', fontSize: fs(13), color: colors.muted },
  errorText: { fontFamily: 'ShareTechMono_400Regular', fontSize: fs(13), color: colors.muted },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, padding: 16, maxHeight: '60%' },
  sheetTitle: { fontFamily: 'ShareTechMono_400Regular', fontSize: fs(12), color: colors.muted, letterSpacing: 2, marginBottom: 12 },
  picker: { width: '100%', marginBottom: 8 },
  pickerStepLabel: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(11),
    color: colors.muted,
    letterSpacing: 2,
    marginBottom: 4,
  },
  webPickerRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  webInput: {
    flex: 1,
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(14),
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    borderRadius: 2,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    padding: 14,
    borderRadius: 2,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(13),
    color: colors.bg,
    letterSpacing: 2,
  },
  choreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface2,
    gap: 12,
  },
  choreCheck: {
    width: 20,
    height: 20,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choreCheckDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  choreCheckMark: { fontSize: fs(12), color: colors.bg, fontFamily: 'ShareTechMono_400Regular' },
  choreTextWrap: { flex: 1 },
  choreText: { fontFamily: 'Barlow_400Regular', fontSize: fs(15), color: colors.text },
  choreTextDone: { color: colors.muted, textDecorationLine: 'line-through' },
  choreAssignee: { fontFamily: 'ShareTechMono_400Regular', fontSize: fs(11), color: colors.muted, marginTop: 2 },
  choreInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  choreInput: {
    flex: 1,
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(13),
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 2,
  },
  choreAddBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 2,
  },
  choreAddBtnDisabled: { backgroundColor: colors.surface2 },
  choreAddBtnText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(12),
    color: colors.bg,
    letterSpacing: 1,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface2,
  },
  historyLeft: { gap: 2 },
  historyType: { fontFamily: 'Barlow_600SemiBold', fontSize: fs(14), color: colors.text },
  historyDate: { fontFamily: 'ShareTechMono_400Regular', fontSize: fs(11), color: colors.muted },
  historyStatus: { fontFamily: 'ShareTechMono_400Regular', fontSize: fs(11), letterSpacing: 1 },
  statusOption: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.surface2 },
  statusOptionActive: { backgroundColor: colors.surface2 },
  statusOptionText: { fontFamily: 'ShareTechMono_400Regular', fontSize: fs(13), letterSpacing: 1 },
  statusOptionSub: { fontFamily: 'Barlow_400Regular', fontSize: fs(12), color: colors.muted, marginTop: 3 },
});
