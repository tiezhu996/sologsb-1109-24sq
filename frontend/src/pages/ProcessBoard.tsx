import { useMemo } from 'react';
import { Alert, Button, Card, Col, Row, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { Link } from 'react-router-dom';
import StatBadge from '../components/common/StatBadge';
import ProcessTimeline from '../components/common/ProcessTimeline';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { useSampleStore } from '../stores/sampleStore';
import { dueSamples } from '../utils/degree';
import type { ProcessBatch } from '../types/process-batch';
import type { SampleExpiry } from '../types/retain-sample';

const { Title, Paragraph, Text } = Typography;

/** 首页：待质检批次名单与留样到期提示 */
export default function ProcessBoard() {
  const herbs = useHerbStore((s) => s.herbs);
  const methods = useMethodStore((s) => s.methods);
  const batches = useBatchStore((s) => s.batches);
  const samples = useSampleStore((s) => s.samples);

  const pendingQc = useMemo(() => batches.filter((b) => b.qcStatus === 'pending'), [batches]);
  const due = useMemo(() => dueSamples(samples, 30), [samples]);
  const degreeCount = useMemo(() => {
    return batches.reduce(
      (acc, b) => {
        acc[b.degree] += 1;
        return acc;
      },
      { 不及: 0, 适中: 0, 太过: 0 } as Record<ProcessBatch['degree'], number>,
    );
  }, [batches]);

  const avgYield = useMemo(() => {
    if (batches.length === 0) return 0;
    return Number((batches.reduce((sum, b) => sum + b.yieldRate, 0) / batches.length).toFixed(1));
  }, [batches]);

  const herbName = (id: string) => herbs.find((h) => h.id === id)?.name ?? '未知药材';

  const pendingColumns: TableColumnsType<ProcessBatch> = [
    { title: '生产批号', dataIndex: 'batchNo', width: 140, render: (v: string) => <Text strong>{v}</Text> },
    { title: '药材', dataIndex: 'herbId', width: 120, render: (id: string) => herbName(id) },
    {
      title: '得率(%)',
      dataIndex: 'yieldRate',
      width: 100,
      align: 'right',
      render: (v: number) => <Text type={v < 85 ? 'danger' : undefined}>{v}</Text>,
    },
  ];

  const dueColumns: TableColumnsType<SampleExpiry> = [
    { title: '留样编号', width: 150, render: (_, row) => <Text strong>{row.sample.sampleNo}</Text> },
    { title: '柜位', width: 80, render: (_, row) => row.sample.cabinet },
    { title: '留样量(g)', width: 90, align: 'right', render: (_, row) => row.sample.amountG },
    { title: '到期日', width: 110, render: (_, row) => row.expireAt },
    {
      title: '剩余天数',
      width: 100,
      align: 'right',
      render: (_, row) => (
        <Text type={row.daysLeft < 0 ? 'danger' : row.daysLeft <= 30 ? 'warning' : undefined}>
          {row.daysLeft < 0 ? `已过期 ${Math.abs(row.daysLeft)} 天` : `${row.daysLeft} 天`}
        </Text>
      ),
    },
    {
      title: '状态',
      width: 90,
      render: (_, row) => (
        <Tag color={row.state === '已到期' ? 'red' : row.state === '临期' ? 'orange' : 'green'}>{row.state}</Tag>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        中草药炮制工序记录台
      </Title>
      <Paragraph type="secondary">
        按投料量折算辅料、记录火候与得率、逐批判定炮制程度；班组提交后进入待质检，质检员放行即定稿、退回须填原因留痕，留样仅取自已放行批次。数据全部保存在浏览器本地（IndexedDB：
        gbherbprocess-db）。
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="待质检批次" value={pendingQc.length} unit="批" status="warning" hint="班组提交后待质检员复核放行" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="在册药材批次" value={herbs.length} unit="批" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="30 天内到期留样" value={due.length} unit="份" status={due.length > 0 ? 'error' : 'success'} />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="平均得率" value={avgYield} unit="%" status="success" hint={`适中 ${degreeCount['适中']} / 不及 ${degreeCount['不及']} / 太过 ${degreeCount['太过']}`} />
        </Col>
      </Row>

      {due.length > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={`留样到期提醒：${due.length} 份留样已到期或将在 30 天内到期`}
          description={
            <Space wrap>
              {due.slice(0, 6).map((item) => (
                <Tag key={item.sample.id} color={item.daysLeft < 0 ? 'red' : 'orange'}>
                  {item.sample.sampleNo}（柜位 {item.sample.cabinet}
                  {item.daysLeft < 0 ? `，已过期 ${Math.abs(item.daysLeft)} 天` : `，剩 ${item.daysLeft} 天`}）
                </Tag>
              ))}
              <Link to="/samples">
                <Button size="small" type="link">
                  前往留样台账处理
                </Button>
              </Link>
            </Space>
          }
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={15}>
          <Card
            title="待质检批次（质检员复核名单）"
            size="small"
            extra={
              <Link to="/batches?qc=待质检">
                <Button size="small" type="primary">
                  去工序记录台处理
                </Button>
              </Link>
            }
          >
            <Table
              rowKey="id"
              size="small"
              columns={pendingColumns}
              dataSource={pendingQc}
              pagination={{ pageSize: 6, hideOnSinglePage: true }}
              locale={{ emptyText: '暂无待质检批次' }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card title="最近炮制工序" size="small" style={{ marginBottom: 16 }}>
            <ProcessTimeline batches={batches} herbs={herbs} methods={methods} limit={5} />
          </Card>
          <Card title="留样到期提示" size="small">
            <Table
              rowKey={(row) => row.sample.id}
              size="small"
              columns={dueColumns}
              dataSource={due.slice(0, 6)}
              pagination={false}
              locale={{ emptyText: '暂无临期或到期留样' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
