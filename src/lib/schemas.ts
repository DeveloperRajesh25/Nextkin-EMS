/**
 * Every mutation's input contract, in one place.
 *
 * Shared by the client forms and the server handlers, so a field's rules exist
 * once. The server ALWAYS re-parses — client-side validation is a courtesy to
 * the user, never a control.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const emailSchema = z
  .string()
  .trim()
  .min(3, 'Enter an email address')
  .max(254)
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase())

/**
 * Password floor. Length does far more work than a character-class zoo, so the
 * rule is 10+ characters with at least one letter and one digit — enough to stop
 * `password` and `12345678` without pushing people toward `P@ssw0rd!`.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'That password is too long')
  .refine((v) => /[a-zA-Z]/.test(v), 'Include at least one letter')
  .refine((v) => /[0-9]/.test(v), 'Include at least one number')

export const uuid = z.string().uuid('Invalid identifier')
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
export const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour, e.g. #C41E33')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null))

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const signupSchema = z.object({
  orgName: z.string().trim().min(2, 'Enter your organization name').max(120),
  fullName: z.string().trim().min(2, 'Enter your name').max(120),
  email: emailSchema,
  password: passwordSchema,
})
export type SignupInput = z.infer<typeof signupSchema>

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
})

export const forgotPasswordSchema = z.object({ email: emailSchema })

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'Choose a password you have not used here before',
    path: ['newPassword'],
  })

// ---------------------------------------------------------------------------
// Organization settings / onboarding
// ---------------------------------------------------------------------------

export const tenantSettingsSchema = z.object({
  name: z.string().trim().min(2, 'Enter your organization name').max(120),
  primaryColor: hexColor,
  timezone: z.string().trim().min(3).max(64),
  workStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 09:30'),
})

export const onboardingSchema = z.object({
  primaryColor: hexColor,
  timezone: z.string().trim().min(3).max(64),
  departmentName: z.string().trim().min(2, 'Enter a department name').max(80),
})

export const departmentSchema = z.object({
  name: z.string().trim().min(2, 'Enter a department name').max(80),
})

// ---------------------------------------------------------------------------
// Employees — the three wizard steps, composed into one payload
// ---------------------------------------------------------------------------

export const employeeStep1Schema = z.object({
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  email: emailSchema,
  phone: optionalText(32),
  photoKey: optionalText(300),
})

export const employeeStep2Schema = z.object({
  employeeCode: optionalText(40),
  designation: optionalText(80),
  departmentId: uuid.nullable().optional(),
  dateOfJoining: isoDate.nullable().optional(),
  timezone: z.string().trim().min(3).max(64).default('Asia/Kolkata'),
})

export const employeeDocumentSchema = z.object({
  key: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(160).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
})

export const createEmployeeSchema = employeeStep1Schema
  .merge(employeeStep2Schema)
  .extend({
    documents: z.array(employeeDocumentSchema).max(10).default([]),
    sendCredentialsEmail: z.boolean().default(true),
  })
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>

export const updateEmployeeSchema = employeeStep1Schema
  .omit({ email: true })
  .merge(employeeStep2Schema)
  .extend({ isActive: z.boolean().optional() })

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const clockActionSchema = z.object({
  action: z.enum(['in', 'out']),
})

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

export const applyLeaveSchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    reason: z.string().trim().min(5, 'Tell your manager why').max(2000),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'The end date cannot be before the start date',
    path: ['endDate'],
  })

export const decideLeaveSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: optionalText(500),
})

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export const payslipSchema = z.object({
  employeeId: uuid,
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2200),
  key: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(255),
})

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, 'Describe the line item').max(300),
  quantity: z.coerce.number().min(0).max(1_000_000),
  rate: z.coerce.number().min(0).max(100_000_000),
})

export const invoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(1, 'Enter an invoice number').max(60),
  billTo: z.object({
    name: z.string().trim().min(1, 'Who is this invoice for?').max(160),
    email: z.string().trim().max(254).optional().or(z.literal('')),
    address: z.string().trim().max(500).optional().or(z.literal('')),
  }),
  items: z.array(invoiceItemSchema).min(1, 'Add at least one line item').max(100),
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  amountPaid: z.coerce.number().min(0).default(0),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).default('draft'),
  issueDate: isoDate,
  dueDate: isoDate.nullable().optional(),
  notes: optionalText(2000),
})
export type InvoiceInput = z.infer<typeof invoiceSchema>

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationSchema = z
  .object({
    title: z.string().trim().min(2, 'Give it a title').max(200),
    description: optionalText(4000),
    sendToType: z.enum(['all', 'department', 'employee']),
    targetId: uuid.nullable().optional(),
  })
  .refine((v) => v.sendToType === 'all' || !!v.targetId, {
    message: 'Choose who this goes to',
    path: ['targetId'],
  })

// ---------------------------------------------------------------------------
// Work authorization (H-1B)
// ---------------------------------------------------------------------------

export const workAuthSchema = z.object({
  employeeId: uuid,
  visaType: z.string().trim().min(1).max(40).default('H-1B'),
  visaNumber: optionalText(80),
  startDate: isoDate.nullable().optional(),
  expiryDate: isoDate,
  documentKey: optionalText(300),
  notes: optionalText(1000),
})

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export const meetingSchema = z
  .object({
    title: z.string().trim().min(2, 'Give the meeting a title').max(200),
    description: optionalText(4000),
    location: optionalText(300),
    startTime: z.string().datetime({ offset: true }),
    endTime: z.string().datetime({ offset: true }),
    attendees: z
      .array(z.object({ email: emailSchema, name: z.string().trim().max(120).optional() }))
      .max(50)
      .default([]),
  })
  .refine((v) => new Date(v.endTime) > new Date(v.startTime), {
    message: 'The meeting must end after it starts',
    path: ['endTime'],
  })

// ---------------------------------------------------------------------------
// Kanban
// ---------------------------------------------------------------------------

export const boardColumnSchema = z.object({
  name: z.string().trim().min(1, 'Name the column').max(60),
})

export const taskSchema = z.object({
  boardId: uuid,
  columnId: uuid,
  title: z.string().trim().min(2, 'Give the task a title').max(200),
  description: optionalText(4000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueDate: isoDate.nullable().optional(),
  assigneeIds: z.array(uuid).max(20).default([]),
})

/** A drag-drop persist. `position` is fractional so a move writes one row. */
export const moveTaskSchema = z.object({
  columnId: uuid,
  position: z.number().finite(),
})

// ---------------------------------------------------------------------------
// Uploads (two-phase: presign then finalize)
// ---------------------------------------------------------------------------

export const presignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
  purpose: z.enum(['photo', 'payslip', 'employee_doc', 'work_auth', 'logo', 'general']),
})

export const finalizeUploadSchema = z.object({
  key: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  purpose: z.enum(['photo', 'payslip', 'employee_doc', 'work_auth', 'logo', 'general']),
  employeeId: uuid.nullable().optional(),
})

// ---------------------------------------------------------------------------
// Super admin
// ---------------------------------------------------------------------------

export const tenantStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: optionalText(500),
})

export const userActivationSchema = z.object({
  isActive: z.boolean(),
  reason: optionalText(500),
})
