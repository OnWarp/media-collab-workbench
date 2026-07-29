import { useEffect, useState } from 'react';
import { Button, Tabs } from '@cloudflare/kumo';
import { useApp } from '../app-context';
import { messageApi } from '../api';
import type { Message, MessageType } from '../types';
import { Loading, fmtTime } from '../components/common';

const MSG_ICONS: Record<MessageType, string> = {
  claim: '🙋',
  progress: '📈',
  submit: '📨',
  review: '✅',
  reject: '↩️',
  settle: '💰',
  comment: '💬',
  overdue: '⏰',
  abandon: '🚫',
  system: '🔔',
  info: '🔔',
};

export function Messages() {
  const { openModal, navigate, toast, refreshPending, refreshView, me } = useApp();
  const [tab, setTab] = useState<'inbox' | 'recycle'>('inbox');
  const [list, setList] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = tab === 'inbox' ? await messageApi.list() : await messageApi.recycle();
      setList(data);
    } catch (e) {
      toast(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, refreshView]);

  const readAll = async () => {
    await messageApi.read();
    load();
    refreshPending();
  };

  const del = async (id: number) => {
    if (!window.confirm('删除该消息？（7 天内可在回收站找回）')) return;
    try {
      await messageApi.remove(id);
      toast('已删除');
      load();
      refreshPending();
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败');
    }
  };

  const restore = async (id: number) => {
    try {
      await messageApi.restore(id);
      toast('已恢复');
      load();
      refreshPending();
    } catch (e) {
      toast(e instanceof Error ? e.message : '恢复失败');
    }
  };

  const openMsg = async (m: Message) => {
    if (tab === 'inbox') {
      await messageApi.read(m.id);
      refreshPending();
      if (m.target && m.target.view === 'review' && me?.role === 'admin') {
        navigate('review');
        return;
      }
      if (m.topicId) {
        openModal({ type: 'topic', id: m.topicId });
        return;
      }
      load();
    }
  };

  const renderList = () => {
    if (!list.length) {
      return (
        <div className="empty">
          {tab === 'inbox' ? '暂无消息' : '回收站暂无消息'}
        </div>
      );
    }
    return list.map((m) => {
      if (tab === 'inbox') {
        return (
          <div
            key={m.id}
            className={'msg-item' + (m.read ? '' : ' unread')}
            onClick={() => openMsg(m)}
          >
            <div className="mtype">{MSG_ICONS[m.type] || '🔔'}</div>
            <div className="mbody">
              {m.content}
              <div className="mwhen">{fmtTime(m.createdAt)}</div>
            </div>
            <button
              className="msg-del"
              title="删除"
              onClick={(e) => {
                e.stopPropagation();
                del(m.id);
              }}
            >
              🗑️
            </button>
          </div>
        );
      }
      return (
        <div key={m.id} className="msg-item recycled-msg">
          <div className="mtype">{MSG_ICONS[m.type] || '🔔'}</div>
          <div className="mbody">
            {m.content}
            <div className="mwhen">删除于 {fmtTime(m.deletedAt)}</div>
          </div>
          <button className="msg-restore" title="恢复" onClick={() => restore(m.id)}>
            ↩️
          </button>
        </div>
      );
    });
  };

  if (loading) return <Loading />;

  return (
    <div>
      <Tabs
        variant="segmented"
        tabs={[
          { value: 'inbox', label: '收件箱' },
          { value: 'recycle', label: '回收站' },
        ]}
        selectedValue={tab}
        onValueChange={(v) => setTab(v as 'inbox' | 'recycle')}
      />
      <div style={{ marginTop: 16 }}>
        {tab === 'inbox' ? (
          <>
            <div className="toolbar">
              <h3 style={{ margin: 0 }}>站内消息（{list.length}）</h3>
              <div className="spacer" />
              <Button size="sm" onClick={readAll}>
                全部标为已读
              </Button>
            </div>
            <p className="hint" style={{ margin: '0 0 12px' }}>
              已读消息将在 <b>1 小时</b> 后自动删除（可在「回收站」标签 7 天内找回）；也可点右侧 🗑️ 手动删除。
            </p>
          </>
        ) : (
          <p className="hint" style={{ margin: '0 0 12px' }}>
            已删除的消息会在这里保留 <b>7 天</b>，可手动恢复；超时后永久清除。
          </p>
        )}
        {renderList()}
      </div>
    </div>
  );
}
