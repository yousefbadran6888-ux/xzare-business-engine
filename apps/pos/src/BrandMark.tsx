export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`brand-logo ${className}`}
      width="48"
      height="48"
      viewBox="0 0 256 256"
      role="img"
      aria-label="Xzare"
    >
      <rect width="256" height="256" rx="58" fill="#112d46" />
      <path d="M51 57h47l107 142h-48z" fill="#fff" />
      <path d="M157 57h48L99 199H51z" fill="#29b5a6" />
      <path d="m107 131 24-32 23 31-24 32z" fill="#087f82" />
    </svg>
  )
}
