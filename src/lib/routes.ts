/**
 * Paths that are quoted to people rather than merely navigated to — in an email,
 * on the "employee created" screen, in support copy.
 *
 * Deliberately free of `server-only` and of any import: the credentials screen
 * is a client component and the credentials email is server code, and a URL that
 * disagrees between the two is a support ticket.
 */
export const EMPLOYEE_LOGIN_PATH = '/employee-login'
export const ORG_LOGIN_PATH = '/login'
