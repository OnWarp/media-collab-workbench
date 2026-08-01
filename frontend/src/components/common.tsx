import { Badge, Loader } from '@cloudflare/kumo';
import { STAGE_LABELS, stageOrder, fmtTime, fmtMoney } from '../api';
import type { Topic, TopicStatus } from '../types';
import type { MouseEvent } from 'react';

export { fmtTime, fmtMoney };

const STATUS_VARIANT: Record<TopicStatus, 'orange' | 'purple' | 'green'> = {
  pending: 'orange',
  in_progress: 'purple',
  review: 'orange',
  finished: 'green',
};

export function StatusTag({ t }: { t: Topic }) {
  return <Badge variant={STATUS_VARIANT[t.status]}>{t.statusLabel}</Badge>;
}

export function SettleTag({ t }: { t: Topic }) {
  if (t.status !== 'finished' && t.settlementStatus === 'unsettled') return null;
  return (
    <Badge variant={t.settlementStatus === 'settled' ? 'green' : 'neutral'}>
      {t.settleLabel}
    </Badge>
  );
}

export function PriceTag({ t }: { t: Topic }) {
  return (
    <Badge variant="blue">
      {t.workTypeLabel} · ¥{t.displayAmount}
    </Badge>
  );
}

export function StageBar({ t }: { t: Topic }) {
  const order = stageOrder(t);
  const idx = order.indexOf(t.stage);
  return (
    <div className="stages">
      {order.map((s, i) => {
        let cls = 'stage';
        if (i < idx) cls += ' done';
        else if (i === idx) cls += ' current';
        if (t.status === 'review' && s === t.reviewStage) cls += ' review';
        return (
          <div className={cls} key={s}>
            {STAGE_LABELS[s] || s}
          </div>
        );
      })}
    </div>
  );
}

export function Loading({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="loading">
      <Loader />
      <div style={{ marginTop: 10 }}>{label}</div>
    </div>
  );
}

export function FavStar({ on, onClick }: { on: boolean; onClick?: (e: MouseEvent<HTMLSpanElement>) => void }) {
  return (
    <span
      data-fav
      className={on ? 'fav' : 'fav empty'}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
    >
      {on ? '★' : '☆'}
    </span>
  );
}
