import * as React from 'react'
import { cn } from '@/lib/utils'

const fieldBase =
  'w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink shadow-sm transition placeholder:text-ink-muted/70 focus-ring disabled:cursor-not-allowed disabled:bg-page disabled:text-ink-muted aria-[invalid=true]:border-danger'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input ref={ref} type={type} className={cn(fieldBase, 'h-10', className)} {...props} />
  )
)
Input.displayName = 'Input'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 4, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={cn(fieldBase, 'resize-y', className)} {...props} />
))
Textarea.displayName = 'Textarea'

/**
 * A plain `<select>` rather than a Radix listbox. It is keyboard- and
 * screen-reader-correct for free, and on mobile it opens the native picker —
 * which beats a custom popover for the short, well-known option lists this app
 * has (departments, months, statuses).
 */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        fieldBase,
        'h-10 cursor-pointer appearance-none bg-[length:16px] bg-[right_0.7rem_center] bg-no-repeat pr-9',
        className
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  )
)
Select.displayName = 'Select'

export { Input, Textarea, Select, fieldBase }
