import {
  LayoutDashboard, Users, CalendarCheck, CalendarOff, Wallet, FileText, Bell,
  Building2, ShieldCheck, Activity, Settings, KanbanSquare, CalendarDays,
  BadgeCheck, ClipboardList, Receipt, Server,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { UserRole } from '@/types/db'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  /** Match child routes too (`/org/employees/123` highlights `/org/employees`). */
  prefix?: boolean
}

export interface NavSection {
  label: string
  items: NavItem[]
}

/**
 * Grouped navigation, one definition per portal.
 *
 * Sections carry the information hierarchy: a person scanning the sidebar should
 * be able to tell what kind of thing each group is before reading the labels.
 */
const SUPER_NAV: NavSection[] = [
  {
    label: 'Platform',
    items: [
      { href: '/super', label: 'Overview', icon: LayoutDashboard },
      { href: '/super/organizations', label: 'Organizations', icon: Building2, prefix: true },
      { href: '/super/users', label: 'Users', icon: Users },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/super/audit', label: 'Audit log', icon: ShieldCheck },
      { href: '/super/system', label: 'System health', icon: Server },
    ],
  },
]

const ORG_NAV: NavSection[] = [
  {
    label: 'Overview',
    items: [{ href: '/org', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'People',
    items: [
      { href: '/org/employees', label: 'Employees', icon: Users, prefix: true },
      { href: '/org/attendance', label: 'Attendance', icon: CalendarCheck },
      { href: '/org/leaves', label: 'Leaves', icon: CalendarOff },
      { href: '/org/visa', label: 'Work authorization', icon: BadgeCheck },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/org/payroll', label: 'Payroll', icon: Wallet },
      { href: '/org/invoices', label: 'Invoices', icon: Receipt, prefix: true },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { href: '/org/board', label: 'Task board', icon: KanbanSquare },
      { href: '/org/meetings', label: 'Meetings', icon: CalendarDays },
      { href: '/org/notifications', label: 'Notifications', icon: Bell },
      { href: '/org/documents', label: 'Documents', icon: FileText },
    ],
  },
  {
    label: 'Settings',
    items: [{ href: '/org/settings', label: 'Settings', icon: Settings, prefix: true }],
  },
]

const EMPLOYEE_NAV: NavSection[] = [
  {
    label: 'Overview',
    items: [{ href: '/employee', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'My work',
    items: [
      { href: '/employee/attendance', label: 'My attendance', icon: CalendarCheck },
      { href: '/employee/leaves', label: 'Leaves', icon: CalendarOff },
      { href: '/employee/tasks', label: 'My tasks', icon: ClipboardList },
      { href: '/employee/meetings', label: 'Meetings', icon: CalendarDays },
    ],
  },
  {
    label: 'Personal',
    items: [
      { href: '/employee/payslips', label: 'My payslips', icon: Wallet },
      { href: '/employee/notifications', label: 'Notifications', icon: Bell },
      { href: '/employee/profile', label: 'My profile', icon: Settings },
    ],
  },
]

export function navFor(role: UserRole): NavSection[] {
  switch (role) {
    case 'super_admin':
      return SUPER_NAV
    case 'org':
      return ORG_NAV
    default:
      return EMPLOYEE_NAV
  }
}

/** Is `href` the active route for `pathname`? */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.prefix) return pathname === item.href || pathname.startsWith(`${item.href}/`)
  return pathname === item.href
}

export { Activity }
