// Demonstration catalogue only; replace with the confirmed preset API catalogue.
export const PRESET_SUBSYSTEMS = [
  { id: "fcw", name: "前方碰撞预警子系统" },
  { id: "body", name: "车身控制子系统" },
  { id: "power", name: "整车电源管理子系统" },
  { id: "vehicle-state", name: "车辆状态管理子系统" },
  { id: "perception", name: "环境感知子系统" },
  { id: "hmi", name: "HMI 子系统" },
  { id: "steering", name: "转向子系统" },
] as const;
