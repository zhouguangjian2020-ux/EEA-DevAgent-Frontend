import type { UcDocument } from "../features/uc/model";

// Table 7 examples are editable demonstration data, never accepted engineering conclusions.
export function createMockUc(project: string, featureName: string, sourceId: string, index: number, childLock = false): UcDocument {
  const number = childLock ? `UC-XXX-01-${index + 13}` : `UC-${project}-${sourceId.slice(-6).toUpperCase()}-${String(index + 1).padStart(2, "0")}`;
  const names = ["HMI 开启左侧儿童锁", "HMI 关闭左侧儿童锁", "HMI 开启右侧儿童锁", "HMI 关闭右侧儿童锁", "HMI 软开关控制儿童锁"];
  const name = childLock ? names[index] : `${featureName} · ${["正常触发流程", "驾驶员干预流程", "异常退出流程"][index] ?? `场景 ${index + 1}`}`;
  const aggregate = childLock && index === 4;
  return { id: `${project}-uc-${sourceId}-${index + 1}`, featureName, revision: 1, status: "pending", content: {
    name, number, description: aggregate ? "用户通过 HMI 软开关控制左右侧儿童锁，并通过界面确认执行结果与当前状态。" : childLock ? `用户通过 ${name}，确认操作结果与当前状态；具体执行条件及异常策略仍待确认。` : `描述${name}的参与者、前置条件和操作流程。当前内容为待审阅的模板示例。`,
    actors: "用户", preconditions: childLock ? "a&b&c&d\na. 车辆电源状态为上电状态；\nb. 车辆无碰撞；\nc. 车门处于关闭状态；\nd. HMI 系统正常启动。" : "a&b\na. 系统已上电且具备操作条件（待确认）；\nb. 相关输入与运行状态有效（待确认）。",
    mainFlow: aggregate ? "1. 用例开始；\n2. 用户操作 HMI 软开关控制车门儿童锁；\n   按操作进入 a1～a4 分支；发生异常时进入 E1～E4。\n3. HMI 实时显示儿童锁状态，详见 UC-XXX-04-12；\n4. 正常用例结束。" : `1. 用例开始；\n2. 用户执行「${name}」操作；\n3. 系统校验前置条件，处理请求并反馈结果；\n4. 正常用例结束。\n具体触发、反馈与退出策略需结合项目要求确认。`,
    branches: aggregate ? ["a1：操作 HMI 左侧儿童锁开启开关，详见 UC-XXX-01-13；", "a2：操作 HMI 左侧儿童锁关闭开关，详见 UC-XXX-01-14；", "a3：操作 HMI 右侧儿童锁开启开关，详见 UC-XXX-01-15；", "a4：操作 HMI 右侧儿童锁关闭开关，详见 UC-XXX-01-16；"] : ["N/A", "N/A", "N/A", "N/A"],
    exceptions: childLock ? ["E1：后门打开\n1. 假设后门未处于关闭状态，则操作失败；\n2. HMI 提示后门未关闭，具体文案待确认。", "E2：儿童锁执行器故障\n1. [故障检测、执行结果与提示方式待确认]。", "N/A", "E3：儿童锁电机进入热保护状态\n1. [频繁操作判定、保护处理与恢复条件待确认]。", "E4：电源馈电\n1. [异常供电条件、锁状态与恢复策略待确认]。"] : ["E1：车辆状态无效，处理条件待确认。", "E2：执行器故障，检测和反馈策略待确认。", "N/A", "E3：异常操作，保护和恢复策略待确认。", "E4：供电异常，安全状态与恢复策略待确认。"],
    postconditions: "正常事件流（主事件流 / 分支事件流）结束时达到的状态：\n目标操作完成并反馈结果（示例，具体状态待确认）。\n异常事件流结束时达到的状态：\n异常结束后的锁状态及反馈策略待确认。",
    extensions: "N/A", hmi: childLock ? "HMI 显示儿童锁开关状态；操作后更新状态显示，异常时给出相应提示。可补充界面截图，具体交互细节待确认。" : "显示操作状态与执行结果，异常时给出提示。具体界面与反馈文案待确认。",
    regulations: "{法规编号}_{条款号}_{系统}_Req{序号}\n[法规原文待核实]", performance: "响应时间及验收指标 TBD；未将示例参数作为已确认工程指标。", nonfunctional: "N/A",
  } };
}
export function updateMockUc(previous: UcDocument, prompt: string): UcDocument {
  return { ...previous, revision: previous.revision + 1, status: "pending", content: { ...previous.content, description: `${previous.content.description}\n\n本次补充要求（模拟记录）：${prompt.trim()}` } };
}
