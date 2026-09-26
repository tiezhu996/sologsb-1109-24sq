import type { FireLevel } from './processing-method';

/** 炮制程度 */
export type ProcessDegree = '不及' | '适中' | '太过';

/**
 * 质检状态机：
 * - 待质检：班组提交工序记录后进入，得率与程度定住，等待质检员复核
 * - 已放行：质检员放行后定稿，得率与程度不再能改，留样只能从这批里挑
 * - 已退回：质检员退回（必须留原因），班组可修改后重新提交
 */
export type QcStatus = '待质检' | '已放行' | '已退回';

/** 一次质检退回留痕（原因 + 时间 + 操作人，永久保留在批次记录里） */
export interface QcReturnRecord {
  id: string;
  /** 退回原因（必填，空着不让提交） */
  reason: string;
  /** 退回时间 ISO */
  returnedAt: string;
  /** 操作质检员 */
  qcBy: string;
}

/** 炮制工序记录 */
export interface ProcessBatch {
  id: string;
  /** 生产批号 */
  batchNo: string;
  /** 关联药材 */
  herbId: string;
  /** 采用方法 */
  methodId: string;
  /** 投料量（kg） */
  feedKg: number;
  /** 辅料实际用量（kg） */
  auxUsedKg: number;
  /** 火候 */
  fireLevel: FireLevel;
  /** 开始时间 ISO */
  startedAt: string;
  /** 结束时间 ISO */
  endedAt: string;
  /** 得率（%） */
  yieldRate: number;
  /** 程度判定 */
  degree: ProcessDegree;
  /** 操作人 */
  operator: string;
  /** 质检状态：待质检 / 已放行 / 已退回 */
  qcStatus: QcStatus;
  /** 班组最近一次提交时间 ISO */
  submittedAt: string;
  /** 质检放行时间 ISO（退回后清空） */
  releasedAt?: string;
  /** 最近一次经办的质检员 */
  qcBy?: string;
  /** 退回记录（含原因与时间，可多次，随时翻查） */
  returns: QcReturnRecord[];
  /** 备注 */
  remark?: string;
}

/** 程度判定规则说明 */
export interface DegreeRule {
  degree: ProcessDegree;
  condition: string;
  action: string;
}

export const PROCESS_DEGREES: ProcessDegree[] = ['不及', '适中', '太过'];

export const QC_STATUSES: QcStatus[] = ['待质检', '已放行', '已退回'];

export const QC_STATUS_COLORS: Record<QcStatus, string> = {
  待质检: 'gold',
  已放行: 'green',
  已退回: 'red',
};
