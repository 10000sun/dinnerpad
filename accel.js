// KeyboardEvent -> Electron Accelerator 변환 (렌더러와 테스트 공용)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Accel = factory();
})(this, function () {
  const NAMED = {
    Space: 'Space', Enter: 'Return', NumpadEnter: 'Return', Tab: 'Tab', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
    Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  };

  function keyName(code) {
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit(\d)$/.exec(code))) return m[1];
    if ((m = /^F(\d{1,2})$/.exec(code))) return +m[1] >= 1 && +m[1] <= 24 ? code : null;
    if ((m = /^Numpad(\d)$/.exec(code))) return 'num' + m[1];
    return NAMED[code] || null;
  }

  // 일반 키가 없으면(수정키만 눌렀거나 미지원 키) null
  function fromEvent(e) {
    const key = keyName(e.code);
    if (!key) return null;
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    return [...mods, key].join('+');
  }

  const SHOWN = { Control: 'Ctrl', Super: 'Win', Return: 'Enter' };
  const label = (accel) => accel.split('+').map((t) => SHOWN[t] || t).join('+');

  return { fromEvent, label };
});
