import type { FireLevel } from './processing-method';

/** 炮制程度 */
export type ProcessDegree = '不及' | '适中' | '太过';

/** 质检状态：班组提交后待质检，质检员放行即定稿，退回后班组可修改并重新提交 */
export type QcStatus = 'pending' | 'released' | 'returned';

/** 质检放行/退回留痕 */
export interface QcLog {
  id: string;
  /** 动作：放行 / 退回 */
  action: '放行' | '退回';
  /** 质检员 */
  qcBy: string;
  /** 操作时间 ISO */
  at: string;
  /** 退回原因（退回时必填） */
  reason?: string;
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
  /** 得率与程度锁定中（待质检/已放行），仅退回状态可改 */
  locked: boolean;
  /** 锁定时间 */
  lockedAt?: string;
  /** 最近质检操作人 */
  qcBy?: string;
  /** 质检状态 */
  qcStatus: QcStatus;
  /** 质检放行/退回记录（含原因与时间，随时可查） */
  qcLogs: QcLog[];
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

/** 质检状态中文名 */
export const QC_STATUS_LABEL: Record<QcStatus, string> = {
  pending: '待质检',
  released: '已放行',
  returned: '已退回',
};
