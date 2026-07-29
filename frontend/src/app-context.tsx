import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Pending, User } from './types';
import { getStoredMe, getStoredToken, setStoredMe, setStoredToken } from './api';
import { pendingApi } from './api';

export type ViewId =
  | 'board'
  | 'market'
  | 'mine'
  | 'traffic'
  | 'recycle'
  | 'review'
  | 'messages'
  | 'stats'
  | 'users';

export type ModalState =
  | { type: 'none' }
  | { type: 'topic'; id: number }
  | { type: 'create' }
  | { type: 'edit'; id: number }
  | { type: 'traffic'; id: number }
  | { type: 'review'; id: number }
  | { type: 'settle'; id: number }
  | { type: 'boardEdit' }
  | { type: 'tutorial' };

interface ToastItem {
  id: number;
  msg: string;
}

interface AppContextValue {
  me: User | null;
  pending: Pending | null;
  view: ViewId;
  modal: ModalState;
  refreshSignal: number;
  navigate: (v: ViewId) => void;
  setMe: (me: User | null) => void;
  refreshPending: () => Promise<void>;
  toast: (msg: string) => void;
  toasts: ToastItem[];
  openModal: (m: ModalState) => void;
  closeModal: () => void;
  refreshView: () => void;
  logout: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function parseHash(): ViewId {
  const h = window.location.hash.replace(/^#\/?/, '');
  const allowed: ViewId[] = [
    'board',
    'market',
    'mine',
    'traffic',
    'recycle',
    'review',
    'messages',
    'stats',
    'users',
  ];
  return (allowed.includes(h as ViewId) ? h : 'board') as ViewId;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<User | null>(() => getStoredMe());
  const [pending, setPending] = useState<Pending | null>(null);
  const [view, setView] = useState<ViewId>(() => parseHash());
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const navigate = useCallback((v: ViewId) => {
    window.location.hash = '#/' + v;
  }, []);

  const refreshPending = useCallback(async () => {
    if (!getStoredToken()) return;
    try {
      const p = await pendingApi.get();
      setPending(p);
    } catch {
      /* ignore */
    }
  }, []);

  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const openModal = useCallback((m: ModalState) => setModal(m), []);
  const closeModal = useCallback(() => setModal({ type: 'none' }), []);
  const refreshView = useCallback(() => setRefreshSignal((n) => n + 1), []);

  const setMe = useCallback((u: User | null) => {
    setStoredMe(u);
    setMeState(u);
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    setStoredMe(null);
    setMeState(null);
    setPending(null);
  }, []);

  useEffect(() => {
    const onHash = () => setView(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (me) refreshPending();
  }, [me, refreshPending, refreshSignal]);

  const value: AppContextValue = {
    me,
    pending,
    view,
    modal,
    refreshSignal,
    navigate,
    setMe,
    refreshPending,
    toast,
    toasts,
    openModal,
    closeModal,
    refreshView,
    logout,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
