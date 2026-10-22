import type { SVGProps } from 'react'

const paths = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  pos: 'M4 4h16v11H4z M8 20h8 M12 15v5 M7 8h4 M7 11h7',
  products: 'm12 3 9 5v9l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v9 M8 5l9 5',
  stock: 'M3 8 12 3l9 5v13H3z M7 21V11h10v10 M7 15h10 M7 18h10',
  purchases: 'M5 3h14v18H5z M8 7h8 M8 11h8 M12 14v5 m-3-3 3 3 3-3',
  customers:
    'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M22 21v-3a4 4 0 0 0-3-4',
  suppliers:
    'M3 5h11v12H3z M14 9h4l3 4v4h-7 M7 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  invoices: 'M5 3h14v19l-3-2-4 2-4-2-3 2z M8 7h8 M8 11h8 M8 15h5',
  shifts: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  reports: 'M4 3v18h17 M8 16v-5 M13 16V6 M18 16V9',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  users: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-3a6 6 0 0 1 6-5h4a6 6 0 0 1 6 5v3',
  audit: 'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7z m-4 9 3 3 5-6',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  eyeOff:
    'M3 3l18 18 M10 5h2c6 0 10 7 10 7s-1 2-3 4 M6 6c-2 2-4 6-4 6s4 7 10 7c2 0 4-1 5-2 M10 10a3 3 0 0 0 4 4',
  arrow: 'M19 12H5 m6-6-6 6 6 6',
  check: 'm5 12 4 4 10-10',
  plus: 'M12 5v14 M5 12h14',
  lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  close: 'm6 6 12 12 M18 6 6 18',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4 M12 17h.01',
  device: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  barcode: 'M3 5v14 M6 5v14 M10 5v14 M12 5v14 M16 5v14 M20 5v14',
} as const
export type IconName = keyof typeof paths
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  )
}
