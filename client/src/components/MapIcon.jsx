export default function MapIcon({ size = 20, className = '' }) {
  return (
    <svg
      className={`travel-icon map-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.5 5.4 8.8 3l6.4 2.2L20.5 3v15.6L15.2 21l-6.4-2.2-5.3 2.2V5.4Z"
        fill="currentColor"
        opacity=".12"
      />
      <path
        d="M3.5 5.4 8.8 3l6.4 2.2L20.5 3v15.6L15.2 21l-6.4-2.2-5.3 2.2V5.4Zm5.3-2.3v15.7m6.4-13.6V21"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.2 14.9c2.1-3 3.9-4 5.7-2.7 1.5 1 2.7.4 4.1-2"
        stroke="#ff6b4a"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="6.2" cy="14.9" r="1.25" fill="#ff6b4a" />
      <circle cx="16" cy="10.2" r="1.25" fill="#ff6b4a" />
    </svg>
  );
}
