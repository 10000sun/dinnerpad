const path = require('path');

const SIZE = 25;
const dev = (d = {}) => ({ id: String(d.id || ''), label: String(d.label || '') });
const vol = (v) => (Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 100);

function normalize(c = {}) {
  const pads = Array.from({ length: SIZE }, (_, i) => {
    const p = c.pads && c.pads[i];
    if (!p || typeof p.file !== 'string' || !p.file) return null;
    return {
      name: String(p.name || '').slice(0, 40),
      file: path.basename(p.file), // 경로 이탈 방지
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#3b82f6',
      key: typeof p.key === 'string' ? p.key : '',
    };
  });
  const v = c.volume || {};
  // 이전 버전의 단일 device 설정은 "내가 들을 장치"로 이어받는다
  return {
    monitor: dev(c.monitor || c.device),
    mic: dev(c.mic),
    volume: { monitor: vol(v.monitor), mic: vol(v.mic) },
    micOn: c.micOn !== false,
    hotkeys: c.hotkeys !== false,
    alwaysOnTop: c.alwaysOnTop === true,
    closeAction: ['ask', 'tray', 'quit'].includes(c.closeAction) ? c.closeAction : 'ask',
    pads,
  };
}

module.exports = { normalize, SIZE };
