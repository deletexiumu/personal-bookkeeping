interface Props {
  tags: readonly string[]
  /** 沿用商户标签的显示成虚线框，与单笔自己打的区分 */
  inherited?: boolean
  className?: string
}

/** 只读的标签列表：#游戏 #房租 */
export function TagChips({ tags, inherited, className = '' }: Props) {
  if (tags.length === 0) return null
  return (
    <span className={`tag-chips ${className}`} title={inherited ? '沿用商户标签' : undefined}>
      {tags.map((t) => (
        <span key={t} className={`tag-chip tag-chip-static ${inherited ? 'tag-chip-inherited' : ''}`}>
          #{t}
        </span>
      ))}
    </span>
  )
}
