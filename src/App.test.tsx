import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { db } from './db'
import { addTransaction } from './db/transactions'
import { today } from './lib/date'

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

    await user.click(within(sidebar).getByRole('link', { name: '分析' }))
    expect(await screen.findByRole('heading', { level: 1, name: '分析' })).toBeInTheDocument()
    expect(screen.getByText('W5')).toBeInTheDocument()
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

  describe('明细', () => {
    async function seed() {
      await db.open()
      const date = today()
      await addTransaction(db, { type: 'expense', amount: 3200, categoryId: 1, accountId: 4, date, time: '12:30', note: '午饭' })
      await addTransaction(db, { type: 'expense', amount: 18650, categoryId: 3, accountId: 3, date, merchant: '盒马鲜生', source: 'import' })
      await addTransaction(db, { type: 'income', amount: 1200000, categoryId: 8, accountId: 2, date, note: '工资' })
    }

    it('点击流水打开详情，修改后保存', async () => {
      await seed()
      const user = userEvent.setup()
      render(<App />)
      await user.click(await screen.findByRole('button', { name: '餐饮 -¥32.00，查看详情' }))
      const dialog = await screen.findByRole('dialog', { name: '流水详情' })
      const note = within(dialog).getByLabelText('备注')
      expect(note).toHaveValue('午饭')
      await user.clear(note)
      await user.type(note, '团队午餐')
      await user.clear(within(dialog).getByLabelText('金额（元）'))
      await user.type(within(dialog).getByLabelText('金额（元）'), '30+15')
      await user.click(within(dialog).getByRole('button', { name: /保存/ }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(await screen.findByText('已保存')).toBeInTheDocument()
      const row = (await db.transactions.toArray()).find((t) => t.categoryId === 1)
      expect(row).toMatchObject({ note: '团队午餐', amount: 4500 })
    })

    it('删除后可撤销', async () => {
      await seed()
      const user = userEvent.setup()
      render(<App />)
      await screen.findByRole('button', { name: '餐饮 -¥32.00，查看详情' })
      await user.click(screen.getAllByRole('button', { name: '删除这条记录' })[0])
      expect(await screen.findByText(/^已删除/)).toBeInTheDocument()
      await waitFor(async () => expect(await db.transactions.count()).toBe(2))
      await user.click(screen.getByRole('button', { name: '撤销' }))
      await waitFor(async () => expect(await db.transactions.count()).toBe(3))
    })

    it('搜索和筛选，汇总跟随筛选结果', async () => {
      await seed()
      const user = userEvent.setup()
      render(<App />)
      await screen.findByRole('button', { name: '餐饮 -¥32.00，查看详情' })
      expect(screen.getByText('共 3 笔')).toBeInTheDocument()

      await user.type(screen.getByRole('searchbox'), '盒马')
      expect(screen.getByText('共 1 笔')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '餐饮 -¥32.00，查看详情' })).not.toBeInTheDocument()
      expect(within(screen.getByRole('region', { name: '筛选汇总' })).getByText('¥186.50')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: '清除筛选' }))
      await user.selectOptions(screen.getByRole('combobox', { name: '来源' }), '导入')
      expect(screen.getByText('共 1 笔')).toBeInTheDocument()
      await user.selectOptions(screen.getByRole('combobox', { name: '类型' }), '收入')
      expect(screen.getByText('没有符合条件的记录')).toBeInTheDocument()
    })
  })

  describe('账户与分类', () => {
    it('新增账户，余额按初始余额和流水计算', async () => {
      await db.open()
      await addTransaction(db, { type: 'expense', amount: 3200, categoryId: 1, accountId: 4, date: today() })
      window.location.hash = '#/accounts'
      const user = userEvent.setup()
      render(<App />)
      expect(await screen.findByRole('heading', { level: 1, name: '账户' })).toBeInTheDocument()
      const list = await screen.findByRole('list', { name: '账户列表' })
      await waitFor(() => expect(within(list).getByText('-¥32.00')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: '新增账户' }))
      const dialog = await screen.findByRole('dialog', { name: '新增账户' })
      await user.type(within(dialog).getByLabelText('名称'), '招行信用卡')
      await user.selectOptions(within(dialog).getByLabelText('类型'), '信用卡')
      await user.type(within(dialog).getByLabelText('初始余额（元）'), '-500')
      await user.click(within(dialog).getByRole('button', { name: '保存' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(await within(list).findByText('招行信用卡')).toBeInTheDocument()
      expect(within(list).getByText('-¥500.00')).toBeInTheDocument()
      // 负债 = 32 + 500
      expect(within(screen.getByRole('region', { name: '净资产' })).getByText('¥532.00')).toBeInTheDocument()
    })

    it('归档的分类不再出现在记一笔中', async () => {
      window.location.hash = '#/categories'
      const user = userEvent.setup()
      render(<App />)
      await user.click(await screen.findByRole('button', { name: '编辑分类 交通' }))
      const dialog = await screen.findByRole('dialog', { name: '编辑分类' })
      await user.click(within(dialog).getByLabelText(/归档/))
      await user.click(within(dialog).getByRole('button', { name: '保存' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(await screen.findByRole('list', { name: '已归档分类' })).toBeInTheDocument()

      await user.keyboard('n')
      const add = await screen.findByRole('dialog', { name: '记一笔' })
      expect(within(add).getByRole('button', { name: '餐饮' })).toBeInTheDocument()
      expect(within(add).queryByRole('button', { name: '交通' })).not.toBeInTheDocument()
    })

    it('新增分类并选择图标和颜色', async () => {
      window.location.hash = '#/categories'
      const user = userEvent.setup()
      render(<App />)
      await user.click(await screen.findByRole('button', { name: '新增分类' }))
      const dialog = await screen.findByRole('dialog', { name: '新增分类' })
      await user.type(within(dialog).getByLabelText('名称'), '宠物')
      await user.click(within(dialog).getByRole('button', { name: '图标 paw-print' }))
      await user.click(within(dialog).getByRole('button', { name: '紫色' }))
      await user.click(within(dialog).getByRole('button', { name: '保存' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(await screen.findByRole('button', { name: '编辑分类 宠物' })).toBeInTheDocument()
      const saved = await db.categories.where('name').equals('宠物').first()
      expect(saved).toMatchObject({ type: 'expense', icon: 'paw-print', color: 'purple', order: 12 })
    })
  })

  describe('预算', () => {
    it('设置总预算和分类预算，明细汇总卡显示预算进度', async () => {
      await db.open()
      await addTransaction(db, { type: 'expense', amount: 90000, categoryId: 1, accountId: 4, date: today() })
      window.location.hash = '#/budget'
      const user = userEvent.setup()
      render(<App />)

      const total = await screen.findByLabelText('月度总预算（元）')
      await user.type(total, '1000{Enter}')
      expect(await screen.findByText('已设置总预算 ¥1,000.00')).toBeInTheDocument()
      const totalCard = screen.getByRole('region', { name: '总预算' })
      expect(within(totalCard).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '90')
      expect(within(totalCard).getByText(/已用 ¥900.00 · 90%/)).toHaveClass('text-warning')

      await user.type(screen.getByLabelText('餐饮预算（元）'), '800{Enter}')
      await waitFor(async () => expect(await db.budgets.count()).toBe(2))
      expect(await screen.findByText(/超支 ¥100.00/)).toHaveClass('text-expense')

      // 清空即取消
      await user.clear(screen.getByLabelText('餐饮预算（元）'))
      await user.keyboard('{Enter}')
      await waitFor(async () => expect(await db.budgets.count()).toBe(1))

      window.location.hash = '#/transactions'
      const summary = await screen.findByRole('region', { name: '本月汇总' })
      expect(await within(summary).findByRole('progressbar', { name: '本月预算' })).toHaveAttribute('aria-valuenow', '90')
      expect(within(summary).getByText('月预算 ¥1,000.00')).toBeInTheDocument()
    })
  })

  describe('导入', () => {
    const CSV = [
      '我的信用卡账单',
      '',
      '交易日期,交易摘要,人民币金额,交易地点',
      '2026/10/31 12:08,美团外卖-订单 3381,-36.50,上海',
      '2026/10/30 09:12,某某小店,-38.00,上海',
      '2026/10/28,转账-张三,-200.00,',
      '2026/10/26,工资,"8,000.00",',
    ].join('\n')

    it('通用 CSV：映射、预览去重与分类、确认入账，再整批撤销', async () => {
      await db.open()
      await addTransaction(db, { type: 'expense', amount: 20000, categoryId: 7, accountId: 1, date: '2026-10-28', note: '还钱' })
      window.location.hash = '#/import'
      const user = userEvent.setup()
      render(<App />)

      expect(await screen.findByText('还没有导入过账单。导入后可以在这里整批撤销。')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /^通用表格(?!导出)/ }))
      expect(screen.getByRole('heading', { level: 1, name: /导入 · 通用表格/ })).toBeInTheDocument()

      const file = new File([CSV], '信用卡账单.csv', { type: 'text/csv' })
      await user.upload(screen.getByLabelText('选择账单文件'), file)

      // 字段映射：跳过说明行，自动匹配日期、备注、金额
      expect(await screen.findByText(/跳过前 2 行说明 · 4 行数据 · 4 列/)).toBeInTheDocument()
      expect(screen.getByLabelText('「交易日期」映射到')).toHaveValue('date')
      expect(screen.getByLabelText('「交易摘要」映射到')).toHaveValue('note')
      expect(screen.getByLabelText('「人民币金额」映射到')).toHaveValue('amount')
      expect(screen.getByLabelText('「交易地点」映射到')).toHaveValue('ignore')
      expect(screen.getByText('解析成功 4 / 4')).toBeInTheDocument()
      await user.selectOptions(screen.getByLabelText('入账账户（文件里没有账户列或对不上时）'), '银行卡')
      await user.click(screen.getByRole('button', { name: '下一步：预览 4 条' }))

      // 预览：美团外卖按关键词归为餐饮，工资归为工资，某某小店待分类，转账-张三与手记重复
      const summary = await screen.findByRole('region', { name: '导入汇总' })
      expect(within(summary).getByText('新增').previousSibling).toHaveTextContent('2')
      expect(within(summary).getByText('疑似重复').previousSibling).toHaveTextContent('1')
      expect(within(summary).getByText('待分类').previousSibling).toHaveTextContent('1')
      expect(screen.getByLabelText('选择 转账-张三')).not.toBeChecked()
      expect(screen.getByLabelText('选择 某某小店')).toBeChecked()
      expect(screen.getByText('关键词：餐饮')).toBeInTheDocument()

      await user.selectOptions(screen.getByLabelText('「某某小店」的分类'), '购物')
      expect(within(summary).getByText('新增').previousSibling).toHaveTextContent('3')
      await user.click(screen.getByRole('button', { name: '确认导入' }))

      expect(await screen.findByRole('heading', { name: '已入账 3 条' })).toBeInTheDocument()
      const imported = await db.transactions.where('source').equals('import').toArray()
      expect(imported.map((t) => [t.date, t.time, t.type, t.amount, t.categoryId, t.accountId])).toEqual([
        ['2026-10-31', '12:08', 'expense', 3650, 1, 2],
        ['2026-10-30', '09:12', 'expense', 3800, 3, 2],
        ['2026-10-26', undefined, 'income', 800000, 8, 2],
      ])

      // 回到导入中心，在导入记录里整批撤销
      await user.click(screen.getByRole('button', { name: '继续导入' }))
      expect(await screen.findByText(/4 条，入账 3/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '撤销导入 信用卡账单.csv' }))
      const dialog = await screen.findByRole('dialog', { name: '撤销这次导入？' })
      await user.click(within(dialog).getByRole('button', { name: '撤销导入' }))
      expect(await screen.findByText('已撤销导入，删除 3 条流水')).toBeInTheDocument()
      expect(await db.transactions.count()).toBe(1)
      expect(await screen.findByText('已撤销')).toBeInTheDocument()
    })

    it('xlsx 文件提示先另存为 CSV', async () => {
      window.location.hash = '#/import'
      const user = userEvent.setup({ applyAccept: false })
      render(<App />)
      await user.click(await screen.findByRole('button', { name: /^通用表格(?!导出)/ }))
      await user.upload(screen.getByLabelText('选择账单文件'), new File(['x'], 'a.xlsx'))
      expect(await screen.findByRole('alert')).toHaveTextContent('暂时只支持 CSV / TSV')
    })
  })
})
