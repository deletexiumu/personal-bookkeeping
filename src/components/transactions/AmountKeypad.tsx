import { Delete } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import type { KeypadKey } from '../../lib/expression'

interface Props {
  onKey: (key: KeypadKey) => void
  /** 「再记」：保存后清空金额继续记 */
  onAgain: () => void
  disabled?: boolean
}

const ROWS: { key: KeypadKey; label: ReactNode; aria?: string }[][] = [
  [
    { key: '1', label: '1' },
    { key: '2', label: '2' },
    { key: '3', label: '3' },
    { key: 'backspace', label: <Delete size={22} aria-hidden="true" />, aria: '退格' },
  ],
  [
    { key: '4', label: '4' },
    { key: '5', label: '5' },
    { key: '6', label: '6' },
    { key: '+', label: '+', aria: '加' },
  ],
  [
    { key: '7', label: '7' },
    { key: '8', label: '8' },
    { key: '9', label: '9' },
    { key: '-', label: '−', aria: '减' },
  ],
]

/** 金额键盘（M02）。按下时不抢走金额输入框的焦点，桌面端也可以直接用键盘输入。 */
export function AmountKeypad({ onKey, onAgain, disabled }: Props) {
  const keep = (e: MouseEvent) => e.preventDefault()
  const key = (k: KeypadKey, label: ReactNode, aria?: string) => (
    <button
      key={k}
      type="button"
      className="keypad-key t-num-l"
      aria-label={aria}
      onMouseDown={keep}
      onClick={() => onKey(k)}
    >
      {label}
    </button>
  )
  return (
    <div className="keypad" role="group" aria-label="金额键盘">
      {ROWS.flat().map(({ key: k, label, aria }) => key(k, label, aria))}
      <button type="button" className="keypad-key keypad-again" onMouseDown={keep} onClick={onAgain} disabled={disabled}>
        再记
      </button>
      {key('0', '0')}
      {key('.', '.', '小数点')}
      <button type="submit" className="keypad-key keypad-done" disabled={disabled}>
        完成
      </button>
    </div>
  )
}
