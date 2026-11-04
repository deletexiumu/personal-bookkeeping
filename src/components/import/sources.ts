import { Braces, Camera, Landmark, MessageCircle, Sheet, Wallet, type LucideIcon } from 'lucide-react'
import type { ImportSource, Tone } from '../../types'

export interface SourceDef {
  id: ImportSource | 'ocr'
  name: string
  hint: string
  icon: LucideIcon
  tone: Tone
  /** 未上线时显示的里程碑 */
  upcoming?: string
  /** 导出教程 */
  guide: string[]
}

/** 导入中心的来源卡片（M04），顺序与设计稿一致 */
export const SOURCES: SourceDef[] = [
  {
    id: 'wechat',
    name: '微信账单',
    hint: '账单中心导出 xlsx / csv',
    icon: MessageCircle,
    tone: 'green',
    guide: ['微信 → 我 → 服务 → 钱包 → 账单', '右上角「常见问题」→「下载账单」→「用于个人对账」', '选择时间范围，账单会发到邮箱或「微信支付」公众号'],
  },
  {
    id: 'alipay',
    name: '支付宝账单',
    hint: '交易明细 csv',
    icon: Wallet,
    tone: 'blue',
    guide: ['支付宝 → 我的 → 账单', '右上角「…」→「开具交易流水证明」→「用于个人对账」', '选择时间范围，账单会发到邮箱（解压密码见支付宝通知）'],
  },
  {
    id: 'bank',
    name: '银行卡账单',
    hint: 'CSV 对账单',
    icon: Landmark,
    tone: 'purple',
    guide: ['在网银或银行 App 的「交易明细」里选择时间范围导出 CSV', '下载后在这里选择文件，按列确认字段映射即可', 'PDF 对账单暂不支持，可先在网银导出 CSV'],
  },
  {
    id: 'csv',
    name: '通用表格',
    hint: '任意 CSV / TSV',
    icon: Sheet,
    tone: 'orange',
    guide: ['表格至少要有日期和金额两列，可以有收支方向、商户、备注、分类、账户等列', 'Excel 文件请先「另存为」CSV（UTF-8 或 GBK 编码都可以）', '金额可以带正负号，也可以分成支出、收入两列'],
  },
  {
    id: 'ocr',
    name: '截图识别',
    hint: '支付截图、小票 OCR',
    icon: Camera,
    tone: 'cyan',
    upcoming: '规划中',
    guide: ['识别支付截图和小票上的金额、商户和时间，识别方案确定后提供'],
  },
  {
    id: 'json',
    name: '备份恢复',
    hint: '本应用导出的 JSON',
    icon: Braces,
    tone: 'gray',
    upcoming: 'W4-4',
    guide: ['从本应用导出的 JSON 备份原样恢复，按 ID 合并'],
  },
]

export function sourceOf(id: ImportSource | 'ocr'): SourceDef {
  return SOURCES.find((s) => s.id === id)!
}
