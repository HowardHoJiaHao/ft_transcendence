'use client';

export default function SearchBar( { //taking variables to destructure them. so later can call these variables directly instead of props.
  value,
  onChange,
  onSubmit,
}: { //specify the types
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="w-full max-w-[520px] min-w-0 justify-self-center">
      <div className="flex gap-3 items-center justify-between w-full bg-white border border-[var(--border)] rounded-[10px] px-4 py-3 shadow-[var(--shadow)]">
        <input
          type="text"
          placeholder="Search listings, items, sellers..."
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="flex-1 min-w-0 px-3 py-[10px] border border-transparent rounded-lg bg-[#f8f9fa] text-sm focus:outline-none focus:border-[var(--primary)] focus:bg-white"
        />
        <button type="button" className="btn btn-primary" onClick={onSubmit}>
          Search
        </button>
      </div>
    </div>
  );
}
