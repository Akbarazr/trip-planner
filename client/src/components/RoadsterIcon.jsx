export default function RoadsterIcon({ size = 28, className = '' }) {
  return (
    <svg
      className={`travel-icon roadster-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 48 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2.8 15.8 6.2 12.6l9.8-1.8 5.1-5.3h9.5l4.3 4.8 8.3 2.1 2.3 2.2-.7 3.5H4.9l-2.1-2.3Z"
        fill="#ef233c"
      />
      <path
        d="M2.8 15.8 6.2 12.6l9.8-1.8 5.1-5.3h9.5l4.3 4.8 8.3 2.1 2.3 2.2-.7 3.5H4.9l-2.1-2.3Z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m21.1 5.5 3.2 5.1m6.3-5.1-1.8 5.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M17.9 10.8h15.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M23.8 9.5V7.7c0-1 1.3-1.8 2.5-1.8 1.1 0 2.2.8 2.2 1.8v1.8"
        fill="#172033"
      />
      <path
        d="m35 10.5 6.1 1.6-3.4 1.3h-6.2"
        stroke="#fff"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".85"
      />
      <path
        d="M6.8 15.6h36.1M17.4 11.1l-3.2 4.5m19.2-4.7 3.2 4.7"
        stroke="#ffccd2"
        strokeWidth="1.05"
        strokeLinecap="round"
        opacity=".9"
      />
      <path
        d="M7.2 13.2 4.4 14m38.8-.8 2 .8M20.6 15.5h8.8"
        stroke="#720916"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.5" r="4.25" fill="#111827" stroke="#f8fafc" strokeWidth="1.05" />
      <circle cx="12" cy="17.5" r="1.7" fill="#d1d5db" />
      <path d="m12 15.8 1.5 2.6h-3l1.5-2.6Z" fill="#6b7280" />
      <circle cx="37" cy="17.5" r="4.25" fill="#111827" stroke="#f8fafc" strokeWidth="1.05" />
      <circle cx="37" cy="17.5" r="1.7" fill="#d1d5db" />
      <path d="m37 15.8 1.5 2.6h-3l1.5-2.6Z" fill="#6b7280" />
    </svg>
  );
}
