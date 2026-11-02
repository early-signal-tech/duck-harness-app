// An on/off button with a lamp, like the wireframe's STRUCTURED, CACHE, and the
// compressor's ON switch.

export function Toggle({ label, on, onChange, title, small }: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  title?: string;
  small?: boolean;
}) {
  return (
    <button
      className={`toggle${on ? " on" : ""}${small ? " small" : ""}`}
      role="switch"
      aria-checked={on}
      title={title}
      onClick={() => onChange(!on)}
    >
      <span className="lamp" aria-hidden="true" />
      {label}
    </button>
  );
}
