/**
 * Domain row types mirroring supabase/migrations/001_schema.sql.
 *
 * Hand-written rather than generated so the shapes stay readable and reviewable.
 * If you prefer generated types, run:
 *   npx supabase gen types typescript --project-id <ref> > src/types/supabase.ts
 * and pass `Database` as the generic to the clients in src/lib/supabase/.
 */

export type UserRole = 'super_admin' | 'org' | 'employee'
export type TenantStatus = 'active' | 'suspended'
export type LeaveStatus = 'pending' | 'approved' | 'rejected'
export type NotificationTarget = 'all' | 'department' | 'employee'
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
export type CalendarStatus = 'connected' | 'needs_reauth' | 'revoked'
export type MeetingSource = 'app' | 'google'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type DocumentKind = 'general' | 'employee_doc' | 'work_auth' | 'payslip'

export interface Tenant {
  id: string
  name: string
  slug: string
  logo_url: string | null
  primary_color: string
  status: TenantStatus
  timezone: string
  work_start_time: string
  onboarded_at: string | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  tenant_id: string | null
  role: UserRole
  full_name: string | null
  email: string | null
  phone: string | null
  employee_code: string | null
  designation: string | null
  department_id: string | null
  photo_url: string | null
  is_active: boolean
  must_change_password: boolean
  timezone: string
  date_of_joining: string | null
  created_at: string
  updated_at: string
}

export interface Department {
  id: string
  tenant_id: string
  name: string
  created_at: string
}

export interface Attendance {
  id: string
  tenant_id: string
  employee_id: string
  date: string
  login_time: string
  logout_time: string | null
  total_hours: number | null
  is_late: boolean
  created_at: string
}

export interface Leave {
  id: string
  tenant_id: string
  employee_id: string
  start_date: string
  end_date: string
  days: number
  reason: string
  status: LeaveStatus
  approver_id: string | null
  decision_note: string | null
  decided_at: string | null
  created_at: string
}

export interface Payslip {
  id: string
  tenant_id: string
  employee_id: string
  month: number
  year: number
  file_url: string
  file_name: string | null
  uploaded_by: string | null
  created_at: string
}

export interface InvoiceItem {
  description: string
  quantity: number
  rate: number
  amount: number
}

export interface Invoice {
  id: string
  tenant_id: string
  invoice_number: string
  bill_to: { name?: string; email?: string; address?: string }
  items: InvoiceItem[]
  currency: string
  subtotal: number
  tax_percent: number
  total: number
  amount_paid: number
  balance_due: number
  status: InvoiceStatus
  issue_date: string
  due_date: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface AppNotification {
  id: string
  tenant_id: string
  title: string
  description: string | null
  send_to_type: NotificationTarget
  target_id: string | null
  created_by: string | null
  created_at: string
}

export interface WorkAuthorization {
  id: string
  tenant_id: string
  employee_id: string
  visa_type: string
  visa_number: string | null
  start_date: string | null
  expiry_date: string
  document_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type VisaMilestone = 90 | 30 | 7 | 0

export interface VisaReminderLog {
  id: string
  tenant_id: string
  employee_id: string
  work_auth_id: string
  milestone: VisaMilestone
  sent_at: string
}

export interface CalendarConnection {
  id: string
  tenant_id: string
  connected_by: string | null
  google_email: string | null
  google_channel_id: string | null
  google_resource_id: string | null
  channel_expires_at: string | null
  sync_token: string | null
  last_synced_at: string | null
  status: CalendarStatus
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface MeetingAttendee {
  email: string
  name?: string
  responseStatus?: string
}

export interface Meeting {
  id: string
  tenant_id: string
  title: string
  description: string | null
  location: string | null
  meet_link: string | null
  start_time: string
  end_time: string
  google_event_id: string | null
  organizer_id: string | null
  attendees: MeetingAttendee[]
  source: MeetingSource
  read_only: boolean
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

export interface Board {
  id: string
  tenant_id: string
  name: string
  created_by: string | null
  created_at: string
}

export interface BoardColumn {
  id: string
  tenant_id: string
  board_id: string
  name: string
  position: number
  created_at: string
}

export interface Task {
  id: string
  tenant_id: string
  board_id: string
  column_id: string
  title: string
  description: string | null
  position: number
  priority: TaskPriority
  due_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TaskWithAssignees extends Task {
  assignees: Array<Pick<Profile, 'id' | 'full_name' | 'email' | 'photo_url'>>
}

export interface AppDocument {
  id: string
  tenant_id: string
  owner_id: string | null
  employee_id: string | null
  kind: DocumentKind
  file_url: string
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  extracted_text: string | null
  created_at: string
}

export interface AuditLog {
  id: string
  tenant_id: string | null
  actor_id: string | null
  actor_email: string | null
  action: string
  entity: string | null
  entity_id: string | null
  ip: string | null
  meta: Record<string, unknown>
  created_at: string
}

export interface CronRun {
  id: string
  job: string
  ok: boolean
  duration_ms: number | null
  detail: Record<string, unknown>
  created_at: string
}

/** Shape returned by the `current_profile()` RPC (003_auth_hook_and_triggers.sql). */
export interface CurrentProfile {
  id: string
  tenant_id: string | null
  role: UserRole
  full_name: string | null
  email: string | null
  is_active: boolean
  must_change_password: boolean
  tenant_name: string | null
  tenant_slug: string | null
  tenant_status: TenantStatus | null
  tenant_logo_url: string | null
  tenant_primary_color: string | null
  tenant_timezone: string | null
}
