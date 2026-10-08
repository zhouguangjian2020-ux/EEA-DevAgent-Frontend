# UC复制r4真实阻断分析与待确认方案 — 2026-10-05


## 2026-10-05 收到r4完整报告：权限通过，两个数据映射阻断已确定

证据来自用户附件af859f27-7c42-4193-ba33-d1f13b562122/已粘贴的文本.txt首份完整有效JSON，已离线解析保存为E:/Git projects/TS-frontend/deploy/workflows/uc-copy-r4-company-report-20261005.json。容器身份、只读事务、项目/功能身份、engineer01目标UC.create鉴权通过。来源恰好3条，目标0条，目标当前确认PRD为8995ab55-2970-45eb-a214-b572fdc1e4a8。三条源UC均未确认，已取得其实际ID、head修订与内容hash；不再标为未知。复制/确认仍均为0。

唯一两个blockers：
1. UC_SCHEMA_REQUIRES_REVIEW_NO_TRUNCATION_ALLOWED：查看行车记录仪实时影像/退出实时影像/上电自动开启循环录像分别3/3/2条分支，异常均5条。invalid_field_paths仅branches。冻结正式UcCreate要求恰好4个分支栏位，允许空字符串；这是少于固定栏位，不是要求截断多余内容。
2. PRD_CONTENT_DIFFERS_REVIEW_REFERENCE_MAPPING：源PRD hash为3eed8bede93cc7a5f1cacaf816f95c500aa16b28f1b97380f77109ca54e14ae4，目标为0e19bbc613175ce34d289b418207986a81ae9231372e35879359d807030994e9。字节正文不同已证实，业务差异和具体章节差异未比较，不能当作同一内容版本。

拟议复制方案（待用户明确确认，未执行）：保留所有原文字段、已有场景和顺序，缺少的固定分支栏位仅置空，不补编需求、不截断；作为联调待确认样本新建3条UC，引用目标项目已确认PRD，不修改目标PRD，不保留跨项目外键，不继承源确认状态、不改源对象、不复制FR。源场景category/position应在写入准备时核验，不能靠数量将中间空槽压缩或把a3重标为a2。正式创建前重新检查精确源修订/content hash、目标PRD/UC空状态、权限和既有接口事务/幂等性；当前不生成可执行写入指令。3/3/2个已有文本加空栏位通过实际UcCreate离线模型验证；未验证真实公司写入。

同附件末尾的ConvertFrom-Json乱码是本地采集命令缺失原生进程UTF-8解码保护，不是后端JSON损坏。旧12项测试只模拟SSH字符串，未覆盖字节解码，确有测试缺口。新建本地collect-uc-copy-r4-report-utf8-20261005.ps1显式设置并finally恢复Console.OutputEncoding和OutputEncoding，未覆盖旧已交付工具。实际Windows PowerShell 5.1和PowerShell 7上用原生Python子进程输出中文JSON：CP936复现旧版失败，修正版在CP936/UTF-8解析成功，并检查失败/成功后的编码恢复，共10项真实原生进程测试通过；无SSH/DB/公司调用。报告已经完整，当前不要求用户重新执行采集命令。
