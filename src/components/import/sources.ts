import { Braces, Camera, Landmark, MessageCircle, Music2, Sheet, Wallet, type LucideIcon } from 'lucide-react'
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

/** 导入中心的来源卡片（M04）；规划中的放最后 */
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
    id: 'douyin',
    name: '抖音支付账单',
    hint: '交易流水 csv',
    icon: Music2,
    tone: 'red',
    guide: ['在抖音钱包的账单里开具交易流水（用途选个人对账），选择时间范围', '下载 CSV 后在这里选择文件，自动识别，不用手动映射'],
  },
  {
    id: 'bank',
    name: '银行卡账单',
    hint: 'CSV / PDF 流水',
    icon: Landmark,
    tone: 'purple',
    guide: [
      '招商银行「交易流水」PDF、中信银行「个人账户明细证明书」PDF：在银行 App 里开具流水证明（用途选个人对账），下载后直接选择，自动识别',
      '其他银行可在网银「交易明细」里导出 CSV，按列确认字段映射即可；文字可以选中的 PDF 也可以试试',
      '扫描件、加密 PDF 暂不支持',
    ],
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
    id: 'json',
    name: '备份恢复',
    hint: '本应用导出的 JSON',
    icon: Braces,
    tone: 'gray',
    guide: ['在「设置 → 数据备份」导出 JSON 备份文件', '在这里选择备份文件，确认后按 ID 合并恢复：同 ID 的记录被备份覆盖，备份里没有的本地数据保留', '恢复不能撤销，建议先导出一份当前数据'],
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
]

export function sourceOf(id: ImportSource | 'ocr'): SourceDef {
  return SOURCES.find((s) => s.id === id)!
}
