import {
  Bell,
  BookOpen,
  ChartBar,
  ChartLineUp,
  CheckCircle,
  ClipboardText,
  FolderOpen,
  ListBullets,
  Trash,
  Users,
  type Icon,
} from '@phosphor-icons/react';
import { Button } from '@cloudflare/kumo';
import { AppProvider, useApp, type ViewId } from './app-context';
import { Login } from './views/Login';
import { Board } from './views/Board';
import { Market } from './views/Market';
import { MyTopics } from './views/MyTopics';
import { Traffic } from './views/Traffic';
import { RecycleBin } from './views/RecycleBin';
import { Review } from './views/Review';
import { Messages } from './views/Messages';
import { Stats } from './views/Stats';
import { AdminUsers } from './views/AdminUsers';
import { Modals } from './components/Modals';

const TITLES: Record<ViewId, string> = {
  board: '公告看板',
  market: '选题接单',
  mine: '我的',
  traffic: '视频流量',
  recycle: '回收站',
  review: '审核',
  messages: '消息提醒',
  stats: '数据统计',
  users: '成员管理',
};

interface NavItem {
  id: ViewId;
  ico: Icon;
  txt: string;
}

function buildNav(role: string): { label: string; admin?: boolean; items: NavItem[] }[] {
  return [
    {
      label: '工作台',
      items: [
        { id: 'board', ico: ClipboardText, txt: '公告看板' },
        { id: 'market', ico: ListBullets, txt: '选题接单' },
        { id: 'mine', ico: FolderOpen, txt: '我的' },
      ],
    },
    {
      label: '管理',
      admin: true,
      items: [
        { id: 'review', ico: CheckCircle, txt: '审核' },
        { id: 'users', ico: Users, txt: '成员管理' },
      ],
    },
    {
      label: '数据 · 资源',
      items: [
        { id: 'traffic', ico: ChartLineUp, txt: '视频流量' },
        { id: 'stats', ico: ChartBar, txt: '数据统计' },
        { id: 'recycle', ico: Trash, txt: '回收站' },
      ],
    },
    {
      label: '消息',
      items: [{ id: 'messages', ico: Bell, txt: '消息提醒' }],
    },
  ];
}

function Shell() {
  const { me, view, navigate, pending, openModal, logout, toasts } = useApp();
  if (!me) return <Login />;

  const navGroups = buildNav(me.role).filter((g) => !g.admin || me.role === 'admin');

  const badge = (id: ViewId): number | null => {
    if (!pending) return null;
    if (id === 'messages') return pending.unread || null;
    if (id === 'market') return pending.pendingClaim || null;
    if (id === 'review' && me.role === 'admin')
      return pending.review + pending.pendingSettle || null;
    return null;
  };

  const renderView = () => {
    switch (view) {
      case 'board':
        return <Board />;
      case 'market':
        return <Market />;
      case 'mine':
        return <MyTopics />;
      case 'traffic':
        return <Traffic />;
      case 'recycle':
        return <RecycleBin />;
      case 'review':
        return <Review />;
      case 'messages':
        return <Messages />;
      case 'stats':
        return <Stats />;
      case 'users':
        return <AdminUsers />;
      default:
        return <Board />;
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="side-brand">媒 协作台</div>
        <nav className="nav">
          {navGroups.map((g) => (
            <div className="nav-group" key={g.label}>
              <div className="nav-group-label">{g.label}</div>
              {g.items.map((it) => {
                const b = badge(it.id);
                const Ico = it.ico;
                return (
                  <div
                    className={'nav-item' + (view === it.id ? ' active' : '')}
                    key={it.id}
                    onClick={() => navigate(it.id)}
                  >
                    <span className="ico">
                      <Ico size={16} />
                    </span>
                    <span className="txt">{it.txt}</span>
                    {b ? (
                      <span className="nav-badge">{b > 99 ? '99+' : b}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="side-user">
          <div className="avatar">{(me.displayName || '?').slice(0, 1)}</div>
          <div className="side-user-info">
            <div className="side-name">{me.displayName}</div>
            <span className={'role-badge ' + me.role}>
              {me.role === 'admin' ? '管理员' : '普通成员'}
            </span>
          </div>
        </div>
        <Button variant="ghost" onClick={logout} style={{ marginTop: 10 }}>
          退出登录
        </Button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div id="page-title">{TITLES[view]}</div>
          <div className="topbar-right">
            <button
              className="icon-btn"
              onClick={() => openModal({ type: 'tutorial' })}
              title="使用教程"
            >
              📘
            </button>
            <button
              className="icon-btn"
              onClick={() => navigate('messages')}
              title="消息提醒"
              style={{ position: 'relative' }}
            >
              <Bell size={20} />
              {pending && pending.unread > 0 && (
                <span className="badge">
                  {pending.unread > 99 ? '99+' : pending.unread}
                </span>
              )}
            </button>
          </div>
        </header>
        <section className="view">{renderView()}</section>
      </main>

      <Modals />
      <div className="toast-layer">
        {toasts.map((t) => (
          <div className="toast-pill" key={t.id}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
