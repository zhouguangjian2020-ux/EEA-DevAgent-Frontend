# UC生成：Agent结构化输出解析失败（2026-10-05）

## 证据与边界
- 来源：用户提供的后端到Agent请求附件，以及Agent响应正文；未由助手调用公司服务器或Agent。
- 附件：C:/Users/zhouguangjian/.codex/attachments/6201a99c-ce79-4398-acca-200bbe56089e/已粘贴的文本.txt
- POST /api/v1/agent/invoke；scene=FROM_PRD_CREATE_UC；response_format=json。
- 请求和响应的span_id均为d85de75332514f838761a17656a8c4a6。
- 请求和Agent响应的trace_id均为1b50bc8339af42e7a92e2ce13a127b65。
- idempotency_key=b8e73a13-ae30-45bf-a850-f36d5e5d5a97。
- 测试项目bf8f4d08-d086-44bf-9cbe-f31abc67ee03；功能3bb1333a-1ebf-428c-831f-c26dcd66cfa3。
- reference_data包含source、prd_markdown和uc_template（uc-default，版本1）。这不能证明Agent模板工具调用已成功。
- 响应错误：SKILL_OUTPUT_INVALID；技能uc_generate的结构化输出无法解析为JSON。解析位置：line 1 column 10094 (char 10093)，Expecting comma delimiter。
- 用户给出的响应事件未包含HTTP状态码，不推断状态码；原始技能输出仅有前200字符摘要，不能据此确定缺逗号、未转义引号或输出截断。

## 重要：页面预览不是原始导出
附件prd_markdown末尾包含[页面预览已折叠，完整内容查看导出 JSON]。本地联调台labconsole/static/app.js的safePreview在字符串超过16000字符时添加该标记，生成展示副本。这是预览折叠证据，不是实际出站请求截断证据。核对全文、长度或HTTP状态应使用导出的完整trace，不能把预览16024字符当成真实正文长度。

## 当前结论
服务通信已到达Agent的uc_generate输出解析环节；当前阻塞点是Agent侧结构化结果解析，不是先前7018服务不可达。请求明确要求JSON，暂无依据改成text、改鉴权或放宽后端校验。UC生成未通过业务验收；不宣称UC图已通过。

## 给Agent工程师的定位步骤
1. 用trace_id和idempotency_key查询这次执行，读取JSON解码前的原始技能输出，不要只看错误里前200字，也不要覆盖原始证据。
2. 检查第10094列（零基偏移10093）前后约200字符、原始输出长度及结束部分，区分缺分隔符、字符串转义问题和不完整输出。
3. 同时核对模型finish_reason或stop_reason、输出token用量与上限，以及流式拼接或技能封装是否截断。只有证据支持时才判断为token上限。
4. 检查结构化输出约束是否实际用于模型调用；避免手工拼接JSON字符串，按对象序列化处理引号、反斜线和换行。
5. 先保证技能结果可解析为JSON，再按UC模板校验use_cases与每项11个内容字段；scenario内含main_flow、branches、exceptions，省略后端生成的number及对象ID。
6. 对外成功返回沿用scene=FROM_PRD_CREATE_UC及structured.use_cases契约；不要把错误文本当作成功候选返回。
7. 修复后由用户在批准的新项目/DVR范围发起一次新运行。若旧幂等键缓存了失败，不盲目重放或删除服务端记录。

## 状态
已完成证据定位和交接记录；Agent内部原因与修复、真实UC生成和UC图验收仍待后续。此次未改应用代码、凭证、部署脚本、数据库或公司服务。


## 2026-10-05 完整UC生成trace核验与UC图触发边界

完整导出8410aff2-09b8-432c-9299-6d01e925054f的case_id=uc-generation，并非UC图。捕获34事件、capture_status=complete，两项丢弃数均0。seq26为出站Agent请求，正文17641个Unicode码点、SHA256=0e19bbc613175ce34d289b418207986a81ae9231372e35879359d807030994e9，与seq25数据库读取正文逐字一致，未带页面折叠标记。此证据证明捕获的出站正文完整，不等于模型上下文接收证明。

补全先前未知的状态码：seq29 Agent返回422；seq30 SKILL_OUTPUT_INVALID；seq31捕获eof且truncated=false。主业务响应502/agent_upstream_rejected为映射后的错误。原始技能输出故障原因仍需Agent侧定位；捕获完整不等于模型输出未截断。

本地UC图接口先读取当前功能已确认UC，空集合返回empty/uc_count=0，不调用Agent；known_uc_source_version匹配时返回unchanged，也不调用。其他情况在前置检查通过后才调用Agent。联调台UC生成只返回候选，不会自动保存或把候选传给UC图。用户当前UC图运行的trace/result尚未提供，不能用生成trace或以前的empty结果判定本次UC图原因。

审阅证据：E:/Git projects/TS-frontend/deploy/workflows/uc-full-trace-review-20261005-r1.json。未改应用代码、凭证、数据或公司服务；待用户提供UC图那一次的最终结果或导出。
