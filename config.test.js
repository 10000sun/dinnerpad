const test = require('node:test');
const assert = require('node:assert');
const { normalize, SIZE } = require('./config');

test('빈 설정은 기본값으로 채운다', () => {
  const c = normalize();
  assert.strictEqual(c.pads.length, SIZE);
  assert.deepStrictEqual(c.volume, { output: 100, voice: 100 });
  assert.strictEqual(c.output.id, '');
  assert.strictEqual(c.input.id, '');
  assert.deepStrictEqual([c.micOn, c.hotkeys, c.alwaysOnTop], [true, true, false]);
});

test('토글 값은 명시적으로 끈 경우만 반영한다', () => {
  const c = normalize({ micOn: false, hotkeys: false, alwaysOnTop: true });
  assert.deepStrictEqual([c.micOn, c.hotkeys, c.alwaysOnTop], [false, false, true]);
  assert.strictEqual(normalize({ alwaysOnTop: 'yes' }).alwaysOnTop, false);
});

test('창 닫기 동작은 허용된 값만, 아니면 매번 묻기', () => {
  assert.strictEqual(normalize().closeAction, 'ask');
  assert.strictEqual(normalize({ closeAction: 'tray' }).closeAction, 'tray');
  assert.strictEqual(normalize({ closeAction: 'x' }).closeAction, 'ask');
});

test('이전 버전의 device, monitor 설정을 출력 장치로 이어받는다', () => {
  assert.strictEqual(normalize({ device: { id: 'abc', label: 'X' } }).output.id, 'abc');
  const c = normalize({ monitor: { id: 'm', label: 'M' }, volume: { monitor: 30 } });
  assert.deepStrictEqual([c.output.id, c.volume.output], ['m', 30]);
});

test('볼륨은 0~100으로 맞춘다', () => {
  assert.deepStrictEqual(normalize({ volume: { output: 250, voice: -5 } }).volume, { output: 100, voice: 0 });
  assert.strictEqual(normalize({ volume: { output: 'x' } }).volume.output, 100);
});

test('패드 파일명은 경로를 제거하고, 잘못된 색은 기본색', () => {
  const p = normalize({ pads: [{ name: 'a', file: '../../x.wav', color: 'red', key: 'Control+F1' }] }).pads[0];
  assert.strictEqual(p.file, 'x.wav');
  assert.strictEqual(p.color, '#3b82f6');
  assert.strictEqual(normalize({ pads: [{ name: 'a' }] }).pads[0], null);
});
