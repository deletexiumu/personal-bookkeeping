import { Check } from 'lucide-react'

const IMPORT_STEPS = ['选择来源', '上传文件', '字段映射', '预览确认']

/** 导入向导步骤条（D03 四步 / M05 三步） */
export function StepBar({ current, steps = IMPORT_STEPS }: { current: number; steps?: string[] }) {
  return (
    <ol className="card step-bar" aria-label="导入步骤">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li key={label} className="step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step-dot" aria-hidden="true">
              {state === 'done' ? <Check size={14} strokeWidth={3} /> : i + 1}
            </span>
            <span className="t-body-m">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}
