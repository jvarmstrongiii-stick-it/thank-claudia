export type JobStatus =
  | 'Estimate Scheduled' | 'Estimate Given' | 'Approved' | 'Parts Ordered'
  | 'Scheduled' | 'In Progress' | 'Complete' | 'Needs Billing'
  | 'Invoiced' | 'Paid' | 'On Hold' | 'Cancelled';

export type JobType =
  | 'Service Call' | 'New Install' | 'Maintenance'
  | 'Estimate' | 'Emergency' | 'Custom';

export interface Customer {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
}

export interface Equipment {
  id: string;
  customer_id: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  tonnage: string | null;
  refrigerant: string | null;
  fuel_type: 'gas' | 'electric' | 'oil' | 'other' | null;
  manufacture_year: number | null;
  install_date: string | null;
  condition: 'Good' | 'Fair' | 'Poor' | 'Condemned' | null;
  notes: string | null;
}

export interface JobPhoto {
  id: string;
  job_id: string;
  storage_path: string;
  photo_type: 'equipment' | 'estimate' | 'invoice' | 'other' | null;
  ocr_data: Record<string, unknown> | null;
  created_at: string;
}

export interface Job {
  id: string;
  customer_id: string;
  job_type: JobType;
  status: JobStatus;
  scheduled_time: string | null;
  address: string | null;
  value: number | null;
  notes: string | null;
  priority: number;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  customer: Customer;
}
