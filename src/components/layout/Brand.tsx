/** 品牌标识：图标 + 「陶朱簿 / Personal Bookkeeping」 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="brand-mark">
      <rect width="512" height="512" rx="112" fill="var(--brand-primary)" />
      <rect x="120" y="128" width="272" height="272" rx="40" fill="#fff" />
      <path
        d="M184 208h144M184 264h144M184 320h88"
        stroke="var(--brand-primary)"
        strokeWidth="28"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <BrandMark />
      {!compact && (
        <div className="brand-text">
          <strong className="t-body-m-strong">陶朱簿</strong>
          <span className="t-caption text-tertiary">Personal Bookkeeping</span>
        </div>
      )}
    </div>
  )
}
