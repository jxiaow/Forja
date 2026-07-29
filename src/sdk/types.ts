/** SDK 项目信息 */
export interface SdkProjectInfo {
  /** 显示名称（取自文件名） */
  name: string;
  /** 入口文件绝对路径 */
  path: string;
  /** 项目类型 */
  type: 'sln' | 'makefile';
}

/** 编译模式 */
export type BuildMode = 'debug' | 'release';

/** 目标架构 */
export type Arch = 'x86' | 'x64';

/** 编译动作 */
export type BuildAction = 'Build' | 'Rebuild' | 'Clean';

/** 状态变更事件 */
export interface StateChangeEvent {
  field: 'currentProject' | 'mode' | 'arch' | 'isBuilding';
  oldValue: unknown;
  newValue: unknown;
}

/** 平台类型 */
export type Platform = 'windows' | 'linux';
