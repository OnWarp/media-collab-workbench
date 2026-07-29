import type { ReactNode } from 'react';

interface ModalProps {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  bare?: boolean;
  wide?: boolean;
}

export function Modal({ title, onClose, children, footer, bare }: ModalProps) {
  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-box"
        style={bare ? { width: 'auto', maxWidth: '90vw' } : undefined}
      >
        {!bare && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 8,
            }}
          >
            <h2 style={{ margin: 0 }}>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="关闭">
              ✕
            </button>
          </div>
        )}
        {children}
        {footer && (
          <div className="modal-actions" style={{ marginTop: 18 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
