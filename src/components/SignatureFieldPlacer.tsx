'use client';

import { useRef, useState } from 'react';
import PdfPages from '@/components/PdfPages';
import {
  FIELD_DEFAULT_SIZE,
  FIELD_LABEL,
  MAX_SIGNING_FIELDS,
  type SigningField,
  type SigningFieldType,
} from '@/lib/signingFields';

// Full-screen editor where the TC drops Signature / Initials / Date spots
// onto the exact places in the PDF the signer should fill in. Positions are
// stored as fractions of each page (see SigningField), so they hold up at any
// zoom and are what the server stamps into the finished PDF.

const TOOLS: SigningFieldType[] = ['signature', 'initials', 'date'];

// With several signers each one gets their own color so it's obvious whose
// spot is whose; with a single signer, colors distinguish field types.
const TYPE_COLORS: Record<SigningFieldType, string> = {
  signature: '#2563eb',
  initials: '#d97706',
  date: '#059669',
};
const SIGNER_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4d7c0f'];

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

interface Props {
  documentUrl: string;
  fileName: string;
  initialFields: SigningField[];
  /** People signing, in order. Only their names are used here. */
  signers: { name: string }[];
  onSave: (fields: SigningField[]) => void;
  onCancel: () => void;
}

export default function SignatureFieldPlacer({ documentUrl, fileName, initialFields, signers, onSave, onCancel }: Props) {
  const multi = signers.length > 1;
  const [activeSigner, setActiveSigner] = useState(0);
  const colorFor = (type: SigningFieldType, signer: number) =>
    multi ? SIGNER_COLORS[signer % SIGNER_COLORS.length] : TYPE_COLORS[type];
  const shortName = (i: number) => (signers[i]?.name || `Signer ${i + 1}`).trim().split(/\s+/)[0] || `Signer ${i + 1}`;
  const [fields, setFields] = useState<SigningField[]>(initialFields);
  const [tool, setTool] = useState<SigningFieldType | null>('signature');
  const [loadError, setLoadError] = useState<string | null>(null);
  const idCounter = useRef(initialFields.length);
  const drag = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    rect: DOMRect;
    moved: boolean;
  } | null>(null);

  const counts = TOOLS.map((t) => ({ t, n: fields.filter((f) => f.type === t && f.signer === activeSigner).length }));

  const placeAt = (e: React.MouseEvent<HTMLDivElement>, page: number) => {
    if (!tool) return;
    if (fields.length >= MAX_SIGNING_FIELDS) {
      setLoadError(`You can place at most ${MAX_SIGNING_FIELDS} spots.`);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const { w, h } = FIELD_DEFAULT_SIZE[tool];
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    idCounter.current += 1;
    setLoadError(null);
    setFields((prev) => [
      ...prev,
      {
        id: `f${Date.now().toString(36)}${idCounter.current}`,
        type: tool,
        page,
        x: clamp(cx - w / 2, 0, 1 - w),
        y: clamp(cy - h / 2, 0, 1 - h),
        w,
        h,
        signer: activeSigner,
      },
    ]);
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, f: SigningField, pageEl: HTMLElement | null) => {
    if (!pageEl) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: f.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: f.x,
      origY: f.y,
      rect: pageEl.getBoundingClientRect(),
      moved: false,
    };
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.rect.width;
    const dy = (e.clientY - d.startY) / d.rect.height;
    d.moved = true;
    setFields((prev) =>
      prev.map((f) =>
        f.id === d.id ? { ...f, x: clamp(d.origX + dx, 0, 1 - f.w), y: clamp(d.origY + dy, 0, 1 - f.h) } : f
      )
    );
  };

  const endDrag = () => {
    drag.current = null;
  };

  const removeField = (id: string) => setFields((prev) => prev.filter((f) => f.id !== id));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: '#e5e7eb',
        display: 'flex',
        flexDirection: 'column',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Place signature spots"
    >
      <div
        style={{
          background: '#fff',
          borderBottom: '1px solid #d1d5db',
          padding: '10px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Place signature spots</div>
          <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {counts.map(({ t, n }) => (
            <button
              key={t}
              type="button"
              onClick={() => setTool(tool === t ? null : t)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                cursor: 'pointer',
                border: `2px solid ${colorFor(t, activeSigner)}`,
                background: tool === t ? colorFor(t, activeSigner) : '#fff',
                color: tool === t ? '#fff' : colorFor(t, activeSigner),
                fontWeight: 600,
              }}
            >
              {FIELD_LABEL[t]}{n > 0 ? ` (${n})` : ''}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(fields)}
            style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            {fields.length > 0 ? `Done (${fields.length} spot${fields.length === 1 ? '' : 's'})` : 'Done'}
          </button>
        </div>
        {multi && (
          <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#4b5563' }}>Placing spots for:</span>
            {signers.map((_, i) => {
              const color = SIGNER_COLORS[i % SIGNER_COLORS.length];
              const active = activeSigner === i;
              const n = fields.filter((f) => f.signer === i).length;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveSigner(i)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 14,
                    fontSize: 12,
                    cursor: 'pointer',
                    fontWeight: 600,
                    border: `2px solid ${color}`,
                    background: active ? color : '#fff',
                    color: active ? '#fff' : color,
                  }}
                >
                  {i + 1}. {shortName(i)} ({n})
                </button>
              );
            })}
          </div>
        )}
        <div style={{ flexBasis: '100%', fontSize: 12, color: '#4b5563' }}>
          {tool
            ? `Click on the page to drop a ${FIELD_LABEL[tool].toLowerCase()} spot${multi ? ` for ${shortName(activeSigner)}` : ''}. Drag a spot to move it, ✕ to remove it. Click the selected button again to stop placing.`
            : 'Pick Signature, Initials or Date above, then click on the page. Drag a spot to move it, ✕ to remove it.'}
          {loadError ? <span style={{ color: '#b91c1c', marginLeft: 6 }}>{loadError}</span> : null}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <PdfPages
            url={documentUrl}
            onError={setLoadError}
            renderPageOverlay={(pageIndex) => (
              <div
                style={{ position: 'absolute', inset: 0, cursor: tool ? 'crosshair' : 'default' }}
                onClick={(e) => placeAt(e, pageIndex)}
              >
                {fields
                  .filter((f) => f.page === pageIndex)
                  .map((f) => (
                    <div
                      key={f.id}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => startDrag(e, f, e.currentTarget.parentElement)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      style={{
                        position: 'absolute',
                        left: `${f.x * 100}%`,
                        top: `${f.y * 100}%`,
                        width: `${f.w * 100}%`,
                        height: `${f.h * 100}%`,
                        border: `2px dashed ${colorFor(f.type, f.signer)}`,
                        background: withAlpha(colorFor(f.type, f.signer), 0.15),
                        borderRadius: 3,
                        cursor: 'move',
                        touchAction: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 700,
                        color: colorFor(f.type, f.signer),
                        boxSizing: 'border-box',
                      }}
                    >
                      {multi ? `${shortName(f.signer)} · ${FIELD_LABEL[f.type]}` : FIELD_LABEL[f.type]}
                      <button
                        type="button"
                        aria-label={`Remove ${FIELD_LABEL[f.type]} spot`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeField(f.id);
                        }}
                        style={{
                          position: 'absolute',
                          top: -10,
                          right: -10,
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          border: 'none',
                          background: '#dc2626',
                          color: '#fff',
                          fontSize: 11,
                          lineHeight: '20px',
                          padding: 0,
                          cursor: 'pointer',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
              </div>
            )}
          />
        </div>
      </div>
    </div>
  );
}
