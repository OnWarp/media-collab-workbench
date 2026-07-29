import { useEffect, useState } from 'react';
import { Button } from '@cloudflare/kumo';
import { useApp } from '../app-context';
import { exportBills, settleApi, topicApi } from '../api';
import type { Topic, WeeklySettlement } from '../types';
import { Loading, fmtMoney, fmtTime } from '../components/common';
import { ReviewCard, TopicCard } from '../components/TopicCard';

export function Review() {
  const { me, openModal, toast, refreshView, refreshPending } = useApp();
  const isAdmin = me?.role === 'admin';
  const [review, setReview] = useState<Topic[]>([]);
  const [finished, setFinished] = useState<Topic[]>([]);
  const [settled, setSettled] = useState<Topic[]>([]);
  const [weekly, setWeekly] = useState<WeeklySettlement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await topicApi.list({ status: 'review' });
        setReview(r);
        if (isAdmin) {
          const [f, s, w] = await Promise.all([
            topicApi.list({ status: 'finished' }),
            topicApi.list({ settlement: 'settled' }),
            settleApi.weekly(),
          ]);
          setFinished(f);
          setSettled(s);
          setWeekly(w);
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshView, isAdmin]);

  if (loading) return <Loading />;

  const pendingSettle = finished.filter((t) => t.settlementStatus === 'unsettled');
  const pendingTotal = pendingSettle.reduce((s, t) => s + (t.displayAmount || 0), 0);

  const weekSettle = async () => {
    if (!window.confirm('将把所有「已完结·待结算」选题一次性结算（按类型自动核算金额：仅文案 ¥15 / 全流程 ¥40），确定？'))
      return;
    try {
      const r = await settleApi.week();
      toast(`周结算完成：${r.count} 笔，合计 ¥${r.total}`);
      refreshPending();
      refreshView();
    } catch (e) {
      toast(e instanceof Error ? e.message : '结算失败');
    }
  };

  return (
    <div>
      <div className="sub-head">
        <h3 style={{ margin: 0 }}>待审核（{review.length}）</h3>
        <span className="muted">在「审核」弹窗中可直观查看文案与视频，通过即完结；驳回需填写修改备注</span>
      </div>
      {review.length ? (
        <div className="grid">
          {review.map((t) => (
            <ReviewCard key={t.id} t={t} onOpen={() => openModal({ type: 'review', id: t.id })} />
          ))}
        </div>
      ) : (
        <div className="empty">暂无待审核选题 🎉</div>
      )}

      {isAdmin && (
        <>
          <div className="sub-head" style={{ marginTop: 28 }}>
            <h3 style={{ margin: 0 }}>结算管理</h3>
            <Button variant="primary" size="sm" onClick={weekSettle}>
              🗓️ 周结算（{pendingSettle.length} 笔 · {fmtMoney(pendingTotal)}）
            </Button>
            <Button size="sm" onClick={() => { exportBills(); toast('账单导出已开始'); }}>
              ⬇ 导出全部 CSV
            </Button>
          </div>

          <h4 style={{ margin: '16px 0 10px' }}>待结算（{pendingSettle.length}）</h4>
          {pendingSettle.length ? (
            <div className="grid">
              {pendingSettle.map((t) => (
                <TopicCard key={t.id} t={t} onClick={() => openModal({ type: 'settle', id: t.id })} />
              ))}
            </div>
          ) : (
            <div className="empty">暂无待结算</div>
          )}

          <h4 style={{ margin: '22px 0 10px' }}>已结算（{settled.length}）</h4>
          {settled.length ? (
            <div className="grid">
              {settled.map((t) => (
                <TopicCard key={t.id} t={t} onClick={() => openModal({ type: 'topic', id: t.id })} />
              ))}
            </div>
          ) : (
            <div className="empty">暂无已结算</div>
          )}

          <h4 style={{ margin: '22px 0 10px' }}>周结算记录（{weekly.length}）</h4>
          {weekly.length ? (
            weekly.map((w) => (
              <div className="msg-item" key={w.id}>
                <div className="mtype">🗓️</div>
                <div className="mbody">
                  当周（{new Date(w.weekStart).getMonth() + 1}/{new Date(w.weekStart).getDate()} 起）· 共{' '}
                  <b>{w.count}</b> 笔 · 合计 <b>{fmtMoney(w.totalAmount)}</b> · 操作人{' '}
                  {w.createdByName || ''}
                  <div className="mwhen">{fmtTime(w.createdAt)}</div>
                </div>
                <Button size="sm" onClick={() => { exportBills(w.id); toast('周账单导出已开始'); }}>
                  导出周账单
                </Button>
              </div>
            ))
          ) : (
            <div className="empty">暂无周结算记录</div>
          )}
        </>
      )}
    </div>
  );
}
