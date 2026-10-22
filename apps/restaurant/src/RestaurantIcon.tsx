const paths: Record<string, string> = {
  tables: 'M5 7h14v10H5z M7 4v3 M17 4v3 M7 17v3 M17 17v3 M2 10h3 M19 10h3 M2 14h3 M19 14h3',
  orders: 'M7 3h10v18H7z M10 7h4 M10 11h4 M10 15h4',
  kitchen: 'M8 10C2 10 2 3 7 3c2 0 3 1 5 1s3-1 5-1c5 0 5 7-1 7v10H8z M8 16h8',
  menu: 'M5 3v6c0 2 4 2 4 0V3 M7 3v18 M17 3v18 M17 3c-4 3-4 8 0 8',
  delivery:
    'M3 6h11v11H3z M14 10h4l3 4v3h-7 M5 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  reservations: 'M4 5h16v16H4z M8 2v6 M16 2v6 M4 10h16 M8 14h2 M14 14h2 M8 17h2',
}
export function RestaurantIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.orders} />
    </svg>
  )
}
