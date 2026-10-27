const test = require('node:test');
const assert = require('node:assert');
const { fromEvent, label } = require('./accel');

const ev = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('조합 키를 Electron 가속기 문자열로 바꾼다', () => {
  assert.strictEqual(fromEvent(ev('F1', { ctrlKey: true })), 'Control+F1');
  assert.strictEqual(fromEvent(ev('KeyA', { ctrlKey: true, altKey: true, shiftKey: true })), 'Control+Alt+Shift+A');
  assert.strictEqual(fromEvent(ev('Digit5', { metaKey: true })), 'Super+5');
  assert.strictEqual(fromEvent(ev('Numpad3')), 'num3');
  assert.strictEqual(fromEvent(ev('ArrowUp', { altKey: true })), 'Alt+Up');
});

test('수정키만 있거나 지원하지 않는 키는 null', () => {
  assert.strictEqual(fromEvent(ev('ControlLeft', { ctrlKey: true })), null);
  assert.strictEqual(fromEvent(ev('F25')), null);
  assert.strictEqual(fromEvent(ev('MediaPlayPause')), null);
});

test('표시용 라벨', () => {
  assert.strictEqual(label('Control+Shift+Return'), 'Ctrl+Shift+Enter');
});
