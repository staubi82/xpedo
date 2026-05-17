const sevenSegments = {
  '0': ['a','b','c','d','e','f'],
  '1': ['b','c'],
  '2': ['a','b','g','e','d'],
  '3': ['a','b','g','c','d'],
  '4': ['f','g','b','c'],
  '5': ['a','f','g','c','d'],
  '6': ['a','f','g','e','c','d'],
  '7': ['a','b','c'],
  '8': ['a','b','c','d','e','f','g'],
  '9': ['a','b','c','d','f','g'],
  '-': ['g'],
};

export function SevenDigit({ value, className = '' }) {
  const active = new Set(sevenSegments[value] || []);
  const seg = (name) => (active.has(name) ? 'opacity-100' : 'opacity-[0.08]');
  return (
    <svg viewBox="0 0 64 112" className={`inline-block fill-current ${className}`} aria-hidden="true">
      <polygon className={seg('a')} points="13,4 51,4 58,11 51,18 13,18 6,11" />
      <polygon className={seg('b')} points="53,20 61,13 61,52 53,60 45,52 45,28" />
      <polygon className={seg('c')} points="53,64 61,56 61,95 53,103 45,95 45,72" />
      <polygon className={seg('d')} points="13,94 51,94 58,101 51,108 13,108 6,101" />
      <polygon className={seg('e')} points="11,64 19,72 19,95 11,103 3,95 3,56" />
      <polygon className={seg('f')} points="11,20 19,28 19,52 11,60 3,52 3,13" />
      <polygon className={seg('g')} points="13,49 51,49 58,56 51,63 13,63 6,56" />
    </svg>
  );
}

export function SevenText({ value, className = '', digitClassName = '' }) {
  return (
    <span className={`inline-flex items-end justify-center gap-[0.05em] text-black ${className}`} aria-label={String(value)}>
      {String(value).split('').map((char, i) => {
        if (char === '.') return <span key={i} className="mb-[0.08em] block h-[0.16em] w-[0.16em] rounded-full bg-current" />;
        if (char === ':') return (
          <span key={i} className="mb-[0.28em] flex h-[0.55em] w-[0.16em] flex-col justify-between">
            <span className="h-[0.13em] w-[0.13em] rounded-full bg-current" />
            <span className="h-[0.13em] w-[0.13em] rounded-full bg-current" />
          </span>
        );
        if (char === '/') return <span key={i} className="px-[0.06em] font-mono text-[0.75em] font-black leading-none">/</span>;
        if (char === ' ') return <span key={i} className="w-[0.35em]" />;
        return <SevenDigit key={i} value={char} className={digitClassName} />;
      })}
    </span>
  );
}
