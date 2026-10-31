/** Original THYNKPDF wordmark: a folded-corner page glyph + logotype. No third-party assets. */
export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 select-none ${className ?? ""}`} aria-label="THYNKPDF">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 2h10l5 5v15H5z" className="fill-brand-600" />
        <path d="M15 2v5h5" className="fill-brand-300" />
        <path d="M8.5 11h7M12 11v7" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {!compact && (
        <span className="text-[15px] font-extrabold tracking-tight">
          <span>THYNK</span><span className="text-brand-600 dark:text-brand-400">PDF</span>
        </span>
      )}
    </span>
  );
}
