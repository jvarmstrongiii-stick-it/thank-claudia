import type { JobStatus } from './types';

export const STATUS_LABELS: Record<JobStatus, string> = {
  'Estimate Scheduled': 'NEXT UP',
  'Estimate Given':     'NEXT UP',
  'Approved':           'NEXT UP',
  'Parts Ordered':      'STANDING BY',
  'Scheduled':          'NEXT UP',
  'In Progress':        'IN FIELD',
  'Complete':           'COMPLETE',
  'Needs Billing':      'STANDING BY',
  'Invoiced':           'STANDING BY',
  'Paid':               'COMPLETE',
  'On Hold':            'ON HOLD',
  'Cancelled':          'ON HOLD',
};

export const STATUS_COLORS: Record<JobStatus, string> = {
  'Estimate Scheduled': '#8fba3c',
  'Estimate Given':     '#8fba3c',
  'Approved':           '#8fba3c',
  'Parts Ordered':      '#2a2b22',
  'Scheduled':          '#8fba3c',
  'In Progress':        '#c8b97a',
  'Complete':           '#2a2b22',
  'Needs Billing':      '#2a2b22',
  'Invoiced':           '#2a2b22',
  'Paid':               '#2a2b22',
  'On Hold':            '#555',
  'Cancelled':          '#555',
};

export const ALL_STATUSES: JobStatus[] = [
  'Estimate Scheduled', 'Estimate Given', 'Approved', 'Parts Ordered',
  'Scheduled', 'In Progress', 'Complete', 'Needs Billing',
  'Invoiced', 'Paid', 'On Hold', 'Cancelled',
];

const ESTIMATE_STATUSES: JobStatus[] = [
  'Estimate Scheduled', 'Estimate Given', 'Approved', 'On Hold', 'Cancelled',
];

const INSTALL_STATUSES: JobStatus[] = [
  'Estimate Scheduled', 'Estimate Given', 'Approved', 'Parts Ordered',
  'Scheduled', 'In Progress', 'Complete', 'Needs Billing',
  'Invoiced', 'Paid', 'On Hold', 'Cancelled',
];

const FIELD_STATUSES: JobStatus[] = [
  'Scheduled', 'In Progress', 'Complete', 'Needs Billing',
  'Invoiced', 'Paid', 'On Hold', 'Cancelled',
];

import type { JobType } from './types';

export function statusesForJobType(jobType: JobType): JobStatus[] {
  switch (jobType) {
    case 'Estimate':   return ESTIMATE_STATUSES;
    case 'New Install': return INSTALL_STATUSES;
    case 'Service Call':
    case 'Maintenance':
    case 'Emergency':
    case 'Custom':
    default:           return FIELD_STATUSES;
  }
}

export function formatTime(iso: string | null): string {
  if (!iso) return '----';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).toLowerCase();
}

export function formatDate(iso: string | null): string {
  if (!iso) return '----';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
