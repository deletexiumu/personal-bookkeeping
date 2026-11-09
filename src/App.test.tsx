import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db } from './db'
import { addTransaction } from './db/transactions'
import { shiftMonth, today } from './lib/date'
import { makeXlsx } from './lib/import/testZip'

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
    expect(screen.getByRole('radiogroup', { name: '区间粒度' })).toBeInTheDocument()

    await user.click(within(sidebar).getByRole('link', { name: '开放接口' }))
    expect(await screen.findByText('即将推出')).toBeInTheDocument()
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

  describe('设置', () => {
    afterEach(() => {
      delete document.documentElement.dataset.theme
      delete document.documentElement.dataset.money
    })

    it('切换主题和金额颜色，记在本机', async () => {
      window.location.hash = '#/settings'
      const user = userEvent.setup()
      render(<App />)
      const theme = await screen.findByRole('radiogroup', { name: '主题' })
      expect(within(theme).getByRole('radio', { name: '跟随系统' })).toHaveAttribute('aria-checked', 'true')
      await user.click(within(theme).getByRole('radio', { name: '深色' }))
      expect(document.documentElement.dataset.theme).toBe('dark')
      await user.click(screen.getByRole('radio', { name: '红收绿支' }))
      expect(document.documentElement.dataset.money).toBe('red-income')
      expect(JSON.parse(localStorage.getItem('taozhubu:preferences')!)).toEqual({ theme: 'dark', moneyColors: 'red-income' })
      await user.click(within(theme).getByRole('radio', { name: '跟随系统' }))
      expect(document.documentElement.dataset.theme).toBeUndefined()
    })

    it('许可与授权', async () => {
      window.location.hash = '#/settings'
      const user = userEvent.setup()
      render(<App />)
      await user.click(await screen.findByRole('button', { name: /许可与授权/ }))
      const dialog = screen.getByRole('dialog', { name: '许可与授权' })
      expect(within(dialog).getByText(/PolyForm Noncommercial/)).toBeInTheDocument()
      expect(within(dialog).getByRole('link', { name: '申请商业授权' })).toHaveAttribute('href', expect.stringContaining('COMMERCIAL.md'))
    })
  })

  describe('分析', () => {
    it('KPI 与上月对比，点击分类和柱子下钻，跳到带筛选的明细', async () => {
      await db.open()
      const month = today().slice(0, 7)
      const lastMonth = shiftMonth(month, -1)
      await addTransaction(db, { type: 'expense', amount: 3000, categoryId: 1, accountId: 1, date: `${month}-02`, merchant: '星巴克' })
      await addTransaction(db, { type: 'expense', amount: 2000, categoryId: 1, accountId: 1, date: `${month}-01`, merchant: '星巴克' })
      await addTransaction(db, { type: 'expense', amount: 8000, categoryId: 2, accountId: 1, date: `${month}-01`, note: '打车' })
      await addTransaction(db, { type: 'income', amount: 100000, categoryId: 8, accountId: 4, date: `${month}-01` })
      await addTransaction(db, { type: 'expense', amount: 10000, categoryId: 1, accountId: 1, date: `${lastMonth}-15` })
      window.location.hash = '#/analysis'
      const user = userEvent.setup()
      render(<App />)

      const kpis = await screen.findByRole('region', { name: '区间概况' })
      expect(await within(kpis).findByText('¥130.00')).toBeInTheDocument()
      expect(within(kpis).getByText(/较上月 \+30%/)).toBeInTheDocument()
      expect(within(kpis).getByText('储蓄率 87%')).toBeInTheDocument()

      // 构成：交通 80 > 餐饮 50
      const shares = screen.getByRole('region', { name: '支出构成' })
      const rows = within(shares).getAllByRole('button')
      expect(rows[0]).toHaveAccessibleName(/^交通，¥80.00，占 61.5%，1 笔/)
      await user.click(within(shares).getByRole('button', { name: /^餐饮/ }))
      const dialog = await screen.findByRole('dialog', { name: /餐饮$/ })
      expect(within(dialog).getByText('共 2 笔 · 支出 ¥50.00')).toBeInTheDocument()

      // 跳到明细页，带上月份和分类筛选
      await user.click(within(dialog).getByRole('link', { name: '在明细页中筛选' }))
      const summary = await screen.findByRole('region', { name: '筛选汇总' })
      expect(await within(summary).findByText('¥50.00')).toBeInTheDocument()
      expect(screen.getByLabelText('分类')).toHaveValue('1')

      // 按天的柱子：切到表格视图，点日期下钻
      window.location.hash = '#/analysis'
      await user.click(await screen.findByRole('button', { name: '表格' }))
      const table = screen.getByRole('table')
      expect(within(table).getByText('合计').closest('tr')).toHaveTextContent('¥130.00')
      await user.click(within(table).getAllByRole('button')[0])
      expect(await screen.findByRole('dialog', { name: /1日 周.支出$/ })).toHaveTextContent('共 2 笔 · 支出 ¥100.00')
    })

    it('切到年，柱子按月并排显示收入和支出', async () => {
      window.location.hash = '#/analysis'
      await addTransaction(db, { type: 'expense', amount: 3000, categoryId: 1, accountId: 1, date: today() })
      const user = userEvent.setup()
      render(<App />)
      await user.click(await screen.findByRole('radio', { name: '年' }))
      const chart = await screen.findByRole('region', { name: '收支趋势' })
      expect(within(chart).getAllByRole('button', { name: /查看明细$/ })).toHaveLength(12)
      expect(within(chart).getByRole('list', { name: '图例' })).toHaveTextContent('支出收入')
      expect(screen.getByText('月均支出')).toBeInTheDocument()
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

    it('旧版 xls 文件提示先另存', async () => {
      window.location.hash = '#/import'
      const user = userEvent.setup({ applyAccept: false })
      render(<App />)
      await user.click(await screen.findByRole('button', { name: /^通用表格(?!导出)/ }))
      await user.upload(screen.getByLabelText('选择账单文件'), new File(['x'], 'a.xls'))
      expect(await screen.findByRole('alert')).toHaveTextContent('旧版 xls 请先另存为 xlsx 或 CSV')
    })

    it('微信 xlsx 账单命中模板，跳过字段映射直接预览', async () => {
      const bytes = await makeXlsx([
        ['微信支付账单明细'],
        [],
        ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态', '交易单号', '商户单号', '备注'],
        ['2026-10-31 12:08:00', '商户消费', '美团外卖', '美团订单', '支出', '¥36.50', '零钱', '支付成功', 'W1', '/', '/'],
        ['2026-10-27 08:00:00', '零钱充值', '招商银行(1234)', '/', '/', '¥500.00', '招商银行(1234)', '充值完成', 'W2', '/', '/'],
      ])
      window.location.hash = '#/import'
      const user = userEvent.setup()
      render(<App />)
      await user.click(await screen.findByRole('button', { name: /^微信账单(?!导出)/ }))
      await user.upload(screen.getByLabelText('选择账单文件'), new File([bytes], '微信支付账单.xlsx'))

      expect(await screen.findByText(/识别为「微信账单」模板 · 2 条/)).toBeInTheDocument()
      expect(screen.getByLabelText('选择 招商银行(1234)')).not.toBeChecked()
      expect(screen.getByText('不计收支')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '确认导入' }))
      expect(await screen.findByRole('heading', { name: '已入账 1 条' })).toBeInTheDocument()
      const [row] = await db.transactions.toArray()
      expect(row).toMatchObject({ merchant: '美团外卖', accountId: 4, categoryId: 1, externalId: 'W1' })
      expect((await db.importBatches.toArray())[0]).toMatchObject({ source: 'wechat', rowCount: 2, importedCount: 1 })
    })

    it('改分类时「记住」生成规则，保存的映射模板下次自动套用', async () => {
      window.location.hash = '#/import'
      const user = userEvent.setup()
      render(<App />)
      await user.click(await screen.findByRole('button', { name: /^通用表格(?!导出)/ }))
      await user.upload(screen.getByLabelText('选择账单文件'), new File([CSV], '信用卡账单-2026-10.csv', { type: 'text/csv' }))

      await user.click(await screen.findByLabelText('保存为模板，下次自动识别'))
      expect(screen.getByLabelText('模板名称')).toHaveValue('信用卡账单')
      await user.click(screen.getByRole('button', { name: '下一步：预览 4 条' }))
      expect(await screen.findByText('已保存模板「信用卡账单」，下次自动识别')).toBeInTheDocument()

      await user.selectOptions(await screen.findByLabelText('「某某小店」的分类'), '购物')
      await user.click(screen.getByLabelText('记住'))
      expect(screen.getByText('入账后记住 1 条分类规则')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '确认导入' }))
      expect(await screen.findByRole('heading', { name: /已入账/ })).toBeInTheDocument()
      expect(await db.rules.toArray()).toMatchObject([{ field: 'note', match: 'contains', keyword: '某某小店', categoryId: 3 }])

      // 第二次导入同样表头的文件：跳过字段映射，规则生效
      await user.click(screen.getByRole('button', { name: '继续导入' }))
      expect(await screen.findByText('我的映射模板')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /^通用表格(?!导出)/ }))
      const next = ['说明', '交易日期,交易摘要,人民币金额,交易地点', '2026/11/02 10:00,某某小店,-12.00,上海'].join('\n')
      await user.upload(screen.getByLabelText('选择账单文件'), new File([next], 'b.csv', { type: 'text/csv' }))
      expect(await screen.findByText(/按模板「信用卡账单」识别 · 1 条/)).toBeInTheDocument()
      expect(screen.getByText('规则：某某小店→购物')).toBeInTheDocument()
    })
  })

  describe('规则', () => {
    it('新增、调整顺序和删除规则', async () => {
      window.location.hash = '#/rules'
      const user = userEvent.setup()
      render(<App />)
      expect(await screen.findByText(/还没有规则/)).toBeInTheDocument()

      for (const [keyword, category] of [
        ['星巴克', '餐饮'],
        ['滴滴', '交通'],
      ]) {
        await user.click(screen.getByRole('button', { name: '新增规则' }))
        const dialog = await screen.findByRole('dialog', { name: '新增规则' })
        await user.type(within(dialog).getByLabelText('关键词'), keyword)
        await user.selectOptions(within(dialog).getByLabelText('归到分类'), category)
        await user.click(within(dialog).getByRole('button', { name: '保存' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      }
      const list = await screen.findByRole('list', { name: '分类规则' })
      expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        expect.stringContaining('商户或备注包含「星巴克」'),
        expect.stringContaining('商户或备注包含「滴滴」'),
      ])
      await user.click(screen.getByRole('button', { name: '上移规则 商户或备注包含「滴滴」' }))
      await waitFor(() =>
        expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('商户或备注包含「滴滴」'),
      )

      await user.click(screen.getByRole('button', { name: '编辑规则 商户或备注包含「星巴克」' }))
      const dialog = await screen.findByRole('dialog', { name: '编辑规则' })
      await user.selectOptions(within(dialog).getByLabelText('匹配方式'), '等于')
      await user.click(within(dialog).getByRole('button', { name: '保存' }))
      expect(await screen.findByText('商户或备注等于「星巴克」')).toBeInTheDocument()
    })
  })

  describe('备份', () => {
    it('设置页导出 JSON 备份', async () => {
      await addTransaction(db, { type: 'expense', amount: 100, accountId: 1, date: today() })
      const blobs: Blob[] = []
      const create = vi.fn((b: Blob) => {
        blobs.push(b)
        return 'blob:backup'
      })
      Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      window.location.hash = '#/settings'
      const user = userEvent.setup()
      render(<App />)
      await user.click(await screen.findByRole('button', { name: '导出备份（JSON）' }))
      expect(await screen.findByText('已导出 1 条流水的备份')).toBeInTheDocument()
      expect(click).toHaveBeenCalled()
      const json = JSON.parse(await blobs[0].text())
      expect(json).toMatchObject({ app: 'taozhubu', format: 1 })
      expect(json.data.transactions).toHaveLength(1)
      click.mockRestore()
    })

    it('设置页导出 CSV 流水', async () => {
      await addTransaction(db, { type: 'expense', amount: 3250, categoryId: 1, accountId: 1, date: '2026-11-04', merchant: '星巴克' })
      const blobs: Blob[] = []
      Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => (blobs.push(b), 'blob:csv')), revokeObjectURL: vi.fn() })
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      window.location.hash = '#/settings'
      const user = userEvent.setup()
      render(<App />)
      await user.click(await screen.findByRole('button', { name: '导出流水（CSV）' }))
      expect(await screen.findByText('已导出 1 条流水')).toBeInTheDocument()
      const text = await blobs[0].text()
      expect(text).toContain('2026-11-04,,支出,32.50,餐饮,现金,,星巴克,,,手动')
      click.mockRestore()
    })

    it('从备份恢复：显示新增与覆盖，确认后按 ID 合并', async () => {
      await addTransaction(db, { type: 'expense', amount: 100, accountId: 1, date: '2026-01-01' })
      const backup = {
        app: 'taozhubu',
        format: 1,
        schema: 6,
        exportedAt: '2026-11-04T08:00:00.000Z',
        data: {
          transactions: [
            { id: 1, type: 'expense', amount: 3200, accountId: 1, date: '2026-11-04', note: '午饭', source: 'manual', createdAt: 1, updatedAt: 1 },
            { id: 9, type: 'income', amount: 500, accountId: 1, date: '2026-11-03', source: 'manual', createdAt: 2, updatedAt: 2 },
          ],
          rules: [{ id: 1, field: 'any', match: 'contains', keyword: '星巴克', categoryId: 1, order: 1 }],
        },
      }
      window.location.hash = '#/import/json'
      const user = userEvent.setup()
      render(<App />)
      await user.upload(await screen.findByLabelText('选择账单文件'), new File([JSON.stringify(backup)], 'taozhubu-backup.json'))
      const table = await screen.findByRole('list', { name: '恢复内容' })
      expect(within(table).getByText('流水').nextSibling).toHaveTextContent('新增 1 · 覆盖 1')
      expect(screen.getByText(/本机有 1 条数据与备份的 ID 相同/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '确认恢复' }))
      expect(await screen.findByRole('heading', { name: '已恢复 3 条数据' })).toBeInTheDocument()
      expect(await db.transactions.get(1)).toMatchObject({ note: '午饭', amount: 3200 })
      expect(await db.rules.count()).toBe(1)
    })

    it('不是备份文件时提示', async () => {
      window.location.hash = '#/import'
      const user = userEvent.setup({ applyAccept: false })
      render(<App />)
      await user.click(await screen.findByRole('button', { name: /^备份恢复(?!导出)/ }))
      await user.upload(screen.getByLabelText('选择账单文件'), new File(['{"a":1}'], 'x.json'))
      expect(await screen.findByRole('alert')).toHaveTextContent('不是陶朱簿导出的备份文件')
    })
  })

  describe('AI 助手', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('没配置时引导去设置；浏览器直连时结合当前页面提问、本机执行工具后显示回答', async () => {
      const user = userEvent.setup()
      const month = today().slice(0, 7)
      await addTransaction(db, { type: 'expense', amount: 3250, categoryId: 1, accountId: 1, date: `${month}-01`, merchant: '美团外卖' })
      render(<App />)
      await user.keyboard('a')
      const panel = await screen.findByRole('complementary', { name: 'AI 助手' })
      expect(await within(panel).findByText(/浏览器直连|服务器转发需要先登录/)).toBeInTheDocument()

      // 设置为浏览器直连
      await user.click(within(panel).getByRole('button', { name: '设置 AI 接入点' }))
      const dialog = await screen.findByRole('dialog', { name: 'AI 接入点' })
      await user.click(within(dialog).getByRole('radio', { name: '浏览器直连' }))
      await user.type(within(dialog).getByLabelText('API Key'), 'sk-ant-test-123456')
      await user.click(within(dialog).getByRole('button', { name: '保存' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(JSON.parse(localStorage.getItem('taozhubu:ai')!)).toMatchObject({ mode: 'direct', direct: { apiKey: 'sk-ant-test-123456' } })

      const bodies: Record<string, unknown>[] = []
      const replies = [
        { content: [{ type: 'tool_use', id: 't1', name: 'query_summary', input: { start: `${month}-01`, end: `${month}-28`, groupBy: 'merchant' } }], stop_reason: 'tool_use' },
        { content: [{ type: 'text', text: '本月主要花在 **美团外卖**：\n- ¥32.50，1 笔' }], stop_reason: 'end_turn' },
      ]
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => {
          bodies.push(JSON.parse(String(init.body)))
          return new Response(JSON.stringify(replies.shift()), { status: 200, headers: { 'content-type': 'application/json' } })
        }),
      )
      expect(within(panel).getByRole('button', { name: /明细 · / })).toHaveAttribute('aria-pressed', 'true')
      await user.type(within(panel).getByLabelText('问题'), '这个月钱花在哪了？{Enter}')

      expect(await within(panel).findByText('美团外卖', { selector: 'strong' })).toBeInTheDocument()
      expect(within(panel).getByText(/按商户/)).toBeInTheDocument()
      expect(within(panel).getByText(/附带：明细 · /)).toBeInTheDocument()
      const first = bodies[0] as { messages: { content: string }[]; system: string }
      expect(first.messages[0].content).toContain('<账本数据>')
      expect(first.messages[0].content).toContain('"page":"明细"')
      expect(first.system).toContain('只回复这一句')
      // 第二次请求带上了本机算好的工具结果
      const second = bodies[1] as { messages: { role: string; content: { type: string; content: string }[] }[] }
      const toolResult = second.messages[2].content[0]
      expect(toolResult.type).toBe('tool_result')
      expect(JSON.parse(toolResult.content)).toMatchObject({ expense: 32.5, groups: [{ name: '美团外卖', amount: 32.5 }] })

      await user.click(within(panel).getByRole('button', { name: '关闭' }))
      expect(panel).not.toHaveClass('is-open')
      expect(screen.getByRole('button', { name: '打开 AI 助手' })).toBeInTheDocument()
    })
  })
})
