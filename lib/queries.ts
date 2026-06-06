import { supabase } from './supabase';
import type { Job, Equipment, JobPhoto, Chore } from './types';

export async function fetchTodaysJobs(): Promise<Job[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from('jobs')
    .select('*, customer:customers(id, name, address, phone)')
    .gte('scheduled_time', start.toISOString())
    .lte('scheduled_time', end.toISOString())
    .order('scheduled_time');

  if (error) throw error;
  return (data ?? []) as Job[];
}

export async function fetchAllJobs(): Promise<Job[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, customer:customers(id, name, address, phone)')
    .order('scheduled_time');

  if (error) throw error;
  return (data ?? []) as Job[];
}

export async function fetchCustomerHistory(customerId: string, excludeJobId: string): Promise<Job[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, customer:customers(id, name, address, phone)')
    .eq('customer_id', customerId)
    .neq('id', excludeJobId)
    .order('scheduled_time', { ascending: false })
    .limit(10);

  if (error) throw error;
  return (data ?? []) as Job[];
}

export async function fetchJob(id: string): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, customer:customers(id, name, address, phone)')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data as Job | null;
}

export async function updateJobAddress(id: string, address: string) {
  const { error } = await supabase
    .from('jobs')
    .update({ address, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function updateJobStatus(id: string, status: string) {
  const { error } = await supabase
    .from('jobs')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function updateJobTime(id: string, scheduled_time: string) {
  const { error } = await supabase
    .from('jobs')
    .update({ scheduled_time, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// Find a customer by name (case-insensitive), or null if not found
export async function findCustomerByName(name: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('customers')
    .select('id')
    .ilike('name', name)
    .maybeSingle();
  return data ?? null;
}

export async function insertCustomer(fields: {
  name: string;
  address?: string | null;
  phone?: string | null;
}): Promise<string> {
  const { data, error } = await supabase
    .from('customers')
    .insert(fields)
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function insertJob(fields: {
  customer_id: string;
  job_type: string;
  status: string;
  scheduled_time?: string | null;
  address?: string | null;
  value?: number | null;
  notes?: string | null;
}): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .insert({ ...fields, status: fields.status ?? 'Scheduled' })
    .select('*, customer:customers(id, name, address, phone)')
    .single();
  if (error) throw error;
  return data as Job;
}

export async function fetchJobPhotos(jobId: string): Promise<JobPhoto[]> {
  const { data, error } = await supabase
    .from('job_photos')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as JobPhoto[];
}

export async function insertJobPhoto(fields: {
  job_id: string;
  storage_path: string;
  photo_type: string;
  ocr_data?: Record<string, unknown> | null;
}): Promise<JobPhoto> {
  const { data, error } = await supabase
    .from('job_photos')
    .insert(fields)
    .select()
    .single();
  if (error) throw error;
  return data as JobPhoto;
}

export async function fetchEquipmentForJob(jobId: string): Promise<Equipment[]> {
  const { data, error } = await supabase
    .from('job_equipment')
    .select('equipment:equipment(*)')
    .eq('job_id', jobId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.equipment).filter(Boolean) as Equipment[];
}

export async function fetchChores(jobId: string): Promise<Chore[]> {
  const { data, error } = await supabase
    .from('chores')
    .select('*, assignee:users(name)')
    .eq('job_id', jobId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as Chore[];
}

export async function insertChore(jobId: string, description: string, customerId?: string | null): Promise<Chore> {
  const { data, error } = await supabase
    .from('chores')
    .insert({ job_id: jobId, customer_id: customerId ?? null, description, status: 'open', priority: 'normal' })
    .select()
    .single();
  if (error) throw error;
  return data as Chore;
}

export async function toggleChore(id: string, status: 'open' | 'done'): Promise<void> {
  const { error } = await supabase
    .from('chores')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// Upsert equipment by serial (per customer). Returns id + isNew.
export async function upsertEquipment(
  customerId: string,
  jobId: string,
  fields: Partial<Equipment>,
): Promise<{ id: string; isNew: boolean }> {
  let existingId: string | null = null;

  if (fields.serial) {
    const { data } = await supabase
      .from('equipment')
      .select('id')
      .eq('customer_id', customerId)
      .eq('serial', fields.serial)
      .maybeSingle();
    existingId = data?.id ?? null;
  }

  if (existingId) {
    const { error } = await supabase
      .from('equipment')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', existingId);
    if (error) throw error;
    await supabase.from('job_equipment').upsert({ job_id: jobId, equipment_id: existingId });
    return { id: existingId, isNew: false };
  }

  const { data, error } = await supabase
    .from('equipment')
    .insert({ ...fields, customer_id: customerId })
    .select('id')
    .single();
  if (error) throw error;
  await supabase.from('job_equipment').upsert({ job_id: jobId, equipment_id: data.id });
  return { id: data.id, isNew: true };
}
