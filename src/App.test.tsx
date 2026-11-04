import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { db } from './db'

beforeEach(async () => {
  window.location.hash = ''
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
    expect(await screen.findByText('午饭')).toBeInTheDocument()
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
})
