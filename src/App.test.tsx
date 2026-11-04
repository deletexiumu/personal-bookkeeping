import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { db } from './db'

beforeEach(async () => {
  window.location.hash = ''
  localStorage.clear()
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('App', () => {
  it('渲染侧边栏和底部 Tab，并可切换页面', async () => {
    const user = userEvent.setup()
    render(<App />)
    const sidebar = screen.getByRole('complementary', { name: '主导航' })
    expect(within(sidebar).getByRole('link', { name: '明细' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('navigation', { name: '底部导航' })).toBeInTheDocument()

    await user.click(within(sidebar).getByRole('link', { name: '导入' }))
    expect(await screen.findByRole('heading', { level: 1, name: '导入' })).toBeInTheDocument()
    expect(screen.getByText('W4')).toBeInTheDocument()
  })

  it('按 N 打开记一笔，保存后出现在明细中', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('这个月还没有记录，记下第一笔吧。')).toBeInTheDocument()
    // 等默认分类加载出来再打开
    await act(async () => {
      await db.categories.count()
    })

    await user.keyboard('n')
    const dialog = await screen.findByRole('dialog', { name: '记一笔' })
    const amount = within(dialog).getByLabelText('金额（元）')
    expect(amount).toHaveFocus()

    await user.type(amount, '32')
    await user.click(await within(dialog).findByRole('button', { name: '餐饮' }))
    await user.type(within(dialog).getByLabelText('备注'), '午饭')
    await user.click(within(dialog).getByRole('button', { name: '完成' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText(/^午饭 · \d{2}:\d{2}$/)).toBeInTheDocument()
    expect(screen.getAllByText('-¥32.00').length).toBeGreaterThan(0)
  })

  it('金额不合法时提示错误，Esc 关闭弹窗', async () => {
    const user = userEvent.setup()
    render(<App />)
    const tabbar = screen.getByRole('navigation', { name: '底部导航' })
    await user.click(within(tabbar).getByRole('button', { name: '记一笔' }))
    const dialog = await screen.findByRole('dialog', { name: '记一笔' })
    await user.click(within(dialog).getByRole('button', { name: '完成' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('请输入大于 0 的金额')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('金额键盘四则运算，再记后可撤销', async () => {
    const user = userEvent.setup()
    render(<App />)
    await act(async () => {
      await db.categories.count()
    })
    await user.keyboard('n')
    const dialog = await screen.findByRole('dialog', { name: '记一笔' })
    const keypad = within(dialog).getByRole('group', { name: '金额键盘' })
    for (const name of ['1', '2', '加', '8', '小数点', '5']) {
      await user.click(within(keypad).getByRole('button', { name }))
    }
    expect(within(dialog).getByLabelText('金额（元）')).toHaveValue('12+8.5')
    expect(within(dialog).getByText('= ¥20.50')).toBeInTheDocument()

    await user.click(within(keypad).getByRole('button', { name: '再记' }))
    // 弹窗保持打开，金额清空
    await waitFor(() => expect(within(dialog).getByLabelText('金额（元）')).toHaveValue(''))
    expect(await screen.findByText('已记支出 ¥20.50')).toBeInTheDocument()
    expect(await db.transactions.count()).toBe(1)

    await user.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(async () => expect(await db.transactions.count()).toBe(0))
  })

  it('转账模式选择转出和转入账户', async () => {
    const user = userEvent.setup()
    render(<App />)
    await act(async () => {
      await db.accounts.count()
    })
    await user.keyboard('n')
    const dialog = await screen.findByRole('dialog', { name: '记一笔' })
    await user.click(within(dialog).getByRole('radio', { name: '转账' }))
    await user.type(within(dialog).getByLabelText('金额（元）'), '500')
    await user.selectOptions(within(dialog).getByLabelText('转出账户'), '微信')
    await user.selectOptions(within(dialog).getByLabelText('转入账户'), '银行卡')
    await user.click(within(dialog).getByRole('button', { name: '完成' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('微信 → 银行卡', { exact: false })).toBeInTheDocument()
    const [row] = await db.transactions.toArray()
    expect(row).toMatchObject({ type: 'transfer', amount: 50000 })
  })

  it('沿用上次的分类和账户', async () => {
    const user = userEvent.setup()
    render(<App />)
    await act(async () => {
      await db.categories.count()
    })
    await user.keyboard('n')
    let dialog = await screen.findByRole('dialog', { name: '记一笔' })
    await user.type(within(dialog).getByLabelText('金额（元）'), '6')
    await user.click(within(dialog).getByRole('button', { name: '交通' }))
    await user.selectOptions(within(dialog).getByLabelText('账户'), '支付宝')
    await user.click(within(dialog).getByRole('button', { name: '完成' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.keyboard('n')
    dialog = await screen.findByRole('dialog', { name: '记一笔' })
    expect(within(dialog).getByRole('button', { name: '交通' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByLabelText('账户')).toHaveDisplayValue('支付宝')
  })
})
