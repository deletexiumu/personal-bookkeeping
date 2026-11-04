import type { CategoryType } from '../../types'

/**
 * 内置关键词词典：商户或备注包含关键词时归到对应的默认分类（按分类名匹配，分类被改名或归档时跳过）。
 * 优先级低于用户规则和历史同商户。
 */
export const KEYWORD_DICTIONARY: { type: CategoryType; category: string; keywords: string[] }[] = [
  {
    type: 'expense',
    category: '餐饮',
    keywords: ['美团外卖', '饿了么', '外卖', '星巴克', '瑞幸', '咖啡', '麦当劳', '肯德基', '必胜客', '汉堡王', '喜茶', '奈雪', '蜜雪', '茶饮', '奶茶', '餐厅', '饭店', '食堂', '小吃', '面馆', '火锅', '烧烤', '烘焙', '面包'],
  },
  {
    type: 'expense',
    category: '交通',
    keywords: ['滴滴', '高德打车', '曹操出行', 'T3出行', '花小猪', '打车', '出租车', '地铁', '公交', '铁路', '12306', '航空', '机票', '加油', '中石化', '中石油', '停车', 'ETC', '高速', '哈啰', '共享单车'],
  },
  {
    type: 'expense',
    category: '购物',
    keywords: ['京东', '淘宝', '天猫', '拼多多', '唯品会', '苏宁', '超市', '便利店', '盒马', '山姆', '沃尔玛', '永辉', '罗森', '全家', '7-11', '名创优品', '优衣库', '商城'],
  },
  {
    type: 'expense',
    category: '居住',
    keywords: ['房租', '租金', '物业', '水费', '电费', '燃气', '煤气', '宽带', '自来水', '电力', '国家电网', '暖气', '供暖'],
  },
  {
    type: 'expense',
    category: '娱乐',
    keywords: ['爱奇艺', '腾讯视频', '优酷', '芒果TV', '哔哩哔哩', 'bilibili', 'B站', '网易云音乐', 'QQ音乐', '电影', '影城', '猫眼', '淘票票', 'Steam', '游戏', 'KTV', '健身'],
  },
  {
    type: 'expense',
    category: '医疗',
    keywords: ['医院', '诊所', '药房', '药店', '大药房', '医保', '体检', '牙科', '口腔'],
  },
  { type: 'income', category: '工资', keywords: ['工资', '薪资', '薪金', '代发'] },
  { type: 'income', category: '奖金', keywords: ['奖金', '年终奖', '绩效'] },
  { type: 'income', category: '理财', keywords: ['利息', '结息', '收益', '分红', '余额宝', '理财', '基金'] },
]
