import { useEffect, useState } from 'react';
import { Table } from '@cloudflare/kumo';
import { useApp } from '../app-context';
import { statsApi } from '../api';
import type { StatsAdmin, StatsMe } from '../types';
import { Loading, fmtMoney } from '../components/common';

function StatCard({ num, lbl }: { num: string | number; lbl: string }) {
  return (
    <div className="stat-card">
      <div className="num">{num}</div>
      <div className="lbl">{lbl}</div>
    </div>
  );
}

export function Stats() {
  const { me, toast, refreshView } = useApp();
  const [mine, setMine] = useState<StatsMe | null>(null);
  const [admin, setAdmin] = useState<StatsAdmin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setMine(await statsApi.me());
        if (me?.role === 'admin') setAdmin(await statsApi.admin());
      } catch (e) {
        toast(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [me, toast, refreshView]);

  if (loading || !mine) return <Loading />;

  return (
    <div>
      <h3 style={{ margin: '0 0 14px' }}>我的数据</h3>
      <div className="stat-cards">
        <StatCard num={mine.claimed} lbl="认领选题" />
        <StatCard num={mine.inProgress} lbl="进行中" />
        <StatCard num={mine.finished} lbl="已完结" />
        <StatCard num={mine.pendingSettle} lbl="待结算" />
        <StatCard num={mine.settled} lbl="已结算" />
        <StatCard num={fmtMoney(mine.totalAmount)} lbl="累计稿酬" />
        <StatCard num={mine.published} lbl="我发布的" />
        <StatCard num={mine.favorites} lbl="我的收藏" />
      </div>

      {admin && (
        <>
          <h3 style={{ margin: '24px 0 14px' }}>团队总览</h3>
          <div className="stat-cards">
            <StatCard num={admin.total} lbl="选题总数" />
            <StatCard num={admin.pending} lbl="待认领" />
            <StatCard num={admin.inProgress} lbl="制作中" />
            <StatCard num={admin.review} lbl="待审核" />
            <StatCard num={admin.finished} lbl="已完结" />
            <StatCard num={admin.pendingSettleCount} lbl="待结算数" />
            <StatCard num={fmtMoney(admin.settledAmount)} lbl="已结算总额" />
            <StatCard num={fmtMoney(admin.unsettledAmount)} lbl="待结算总额" />
            <StatCard num={admin.weeklyCount} lbl="周结算次数" />
          </div>
          <h4 style={{ margin: '18px 0 10px' }}>成员接单完工榜</h4>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>成员</Table.Head>
                <Table.Head>接单上限</Table.Head>
                <Table.Head>认领数</Table.Head>
                <Table.Head>完结数</Table.Head>
                <Table.Head>已结算稿酬</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {admin.perMember.map((m) => (
                <Table.Row key={m.id}>
                  <Table.Cell>{m.name}</Table.Cell>
                  <Table.Cell>{m.maxClaims}</Table.Cell>
                  <Table.Cell>{m.claimed}</Table.Cell>
                  <Table.Cell>{m.finished}</Table.Cell>
                  <Table.Cell>{fmtMoney(m.settledAmount)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </>
      )}
    </div>
  );
}
