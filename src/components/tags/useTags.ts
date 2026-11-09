import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../../db'
import { listTagRules, listTags } from '../../db/tags'
import { makeTagResolver, type TagResolver } from '../../lib/tags'
import type { Tag, TagRule } from '../../types'

export interface TagData {
  tags: Tag[]
  rules: TagRule[]
  resolve: TagResolver
}

/** 标签目录、商户标签，以及按商户标签算出每笔流水实际标签的解析器 */
export function useTags(): TagData {
  const tags = useLiveQuery(() => listTags(db), [], [])
  const rules = useLiveQuery(() => listTagRules(db), [], [])
  const resolve = useMemo(() => makeTagResolver(rules), [rules])
  return { tags, rules, resolve }
}
