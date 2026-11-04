import { SOURCE_LABEL } from '../../lib/filter'
import type { TransactionSource } from '../../types'
import { Badge, type BadgeTone } from '../ui/Badge'

const TONE: Record<TransactionSource, BadgeTone> = {
  manual: 'neutral',
  import: 'brand',
  api: 'warning',
  rule: 'warning',
}

export function SourceBadge({ source }: { source: TransactionSource }) {
  return <Badge tone={TONE[source]}>{SOURCE_LABEL[source]}</Badge>
}
