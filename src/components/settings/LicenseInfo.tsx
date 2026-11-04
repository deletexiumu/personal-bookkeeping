import { CircleCheck, CircleSlash, ExternalLink } from 'lucide-react'

const REPO = 'https://github.com/deletexiumu/personal-bookkeeping'

const FREE = ['个人或家庭记账', '学习、研究、个人兴趣项目', '非商用前提下修改源码、自行部署给自己或家人', '学校、公益组织等非营利机构使用']
const COMMERCIAL = [
  '公司或个体工商户在经营中使用（包括内部使用）',
  '作为付费产品、付费服务（SaaS）或付费功能提供',
  '集成到商业产品、小程序或应用中',
  '为客户提供收费的部署、定制或运维服务',
]

/** 许可与授权（M06）：PolyForm Noncommercial 的通俗说明，以仓库 LICENSE 原文为准 */
export function LicenseInfo() {
  return (
    <div className="license">
      <p className="t-body-s text-secondary">
        陶朱簿采用 PolyForm Noncommercial License 1.0.0 发布：个人免费使用，商业使用需要另行取得授权。下面是通俗说明，以 LICENSE 原文为准。
      </p>
      <section className="license-block" aria-label="免费使用">
        <h3 className="t-body-m-strong">免费使用</h3>
        <ul className="license-list t-body-s">
          {FREE.map((text) => (
            <li key={text}>
              <CircleCheck size={16} aria-hidden="true" className="text-income" />
              {text}
            </li>
          ))}
        </ul>
      </section>
      <section className="license-block" aria-label="需要商业授权">
        <h3 className="t-body-m-strong">需要商业授权</h3>
        <ul className="license-list t-body-s">
          {COMMERCIAL.map((text) => (
            <li key={text}>
              <CircleSlash size={16} aria-hidden="true" className="text-warning" />
              {text}
            </li>
          ))}
        </ul>
      </section>
      <p className="t-caption text-tertiary">
        再分发（包括修改后的版本）时，需要附上 LICENSE 全文或链接，以及开头的 Required Notice 版权声明。
      </p>
      <div className="license-links">
        <a className="btn btn-secondary btn-md" href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
          <ExternalLink size={16} aria-hidden="true" />
          许可原文
        </a>
        <a className="btn btn-primary btn-md" href={`${REPO}/blob/main/COMMERCIAL.md`} target="_blank" rel="noreferrer">
          <ExternalLink size={16} aria-hidden="true" />
          申请商业授权
        </a>
      </div>
    </div>
  )
}
