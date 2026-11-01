/** THYNKPDF wordmark: the app logo (black rounded square, page with red fold, "t." mark) + logotype. */
export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 select-none ${className ?? ""}`} aria-label="THYNKPDF">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" width={24} height={24} alt="" aria-hidden="true" className="h-6 w-6 shrink-0" />
      {!compact && (
        <span className="text-[15px] font-extrabold tracking-tight">
          <span>THYNK</span><span className="text-brand-600 dark:text-brand-400">PDF</span>
        </span>
      )}
    </span>
  );
}
