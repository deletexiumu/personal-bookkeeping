/** 解析标签输入：「#家庭 #周末」「家庭，周末」都得到 ['家庭', '周末']，去重保序 */
export function parseTags(input: string): string[] {
  const tags = input
    .split(/[\s,，、#＃]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  return [...new Set(tags)]
}

export function formatTags(tags: string[] | undefined): string {
  return (tags ?? []).map((t) => `#${t}`).join(' ')
}
