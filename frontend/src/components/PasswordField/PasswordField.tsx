"use client";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.9 5.1A10.7 10.7 0 0 1 12 5c7 0 10 7 10 7a18.2 18.2 0 0 1-3.2 4.4" />
      <path d="M6.1 6.1C3.7 7.8 2 12 2 12s3 7 10 7c1.7 0 3.2-.4 4.5-1" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function PasswordField({
  placeholder,
  value,
  onChange,
  show,
  onToggle,
  showLabel,
  hideLabel,
  className = "w-full p-3 pr-12 border border-[#ccc] rounded text-base",
  autoComplete = "off",
  required = true,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
  className?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className={className}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#666] bg-transparent border-0 cursor-pointer rounded-md hover:text-[#111]"
        onClick={onToggle}
        aria-label={show ? hideLabel : showLabel}
        aria-pressed={show}
      >
        <EyeIcon open={show} />
      </button>
    </div>
  );
}
