// Shared SVG cookie logo - chocolate chip cookie with bite taken out
function getCookieSVG(size = 28) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="cookieGrad" cx="40%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#D4956A"/>
      <stop offset="100%" stop-color="#8B5A2B"/>
    </radialGradient>
    <radialGradient id="biteGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#C9A96E" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#8B5A2B" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- Cookie base with bite taken from top-right -->
  <path d="
    M 50 8
    C 62 6, 76 10, 84 20
    Q 88 26, 86 32
    Q 92 38, 88 46
    C 94 58, 90 72, 80 82
    C 68 94, 48 96, 34 88
    C 18 80, 10 64, 12 48
    C 10 32, 20 16, 35 10
    C 40 8, 45 8, 50 8 Z
  " fill="url(#cookieGrad)"/>
  <!-- Bite shadow inner -->
  <path d="
    M 76 10
    Q 88 16, 88 28
    Q 92 22, 86 14
    Q 82 8, 76 10 Z
  " fill="#6B3F1A" opacity="0.5"/>
  <!-- Bite edge highlight -->
  <path d="
    M 76 10
    Q 88 16, 88 28
    Q 84 20, 78 14
    Q 77 12, 76 10 Z
  " fill="#C4834A" opacity="0.6"/>
  <!-- Cookie texture dots -->
  <circle cx="35" cy="30" r="3.5" fill="#6B3F1A" opacity="0.4"/>
  <circle cx="55" cy="25" r="2.5" fill="#6B3F1A" opacity="0.3"/>
  <circle cx="65" cy="45" r="3" fill="#6B3F1A" opacity="0.35"/>
  <circle cx="30" cy="52" r="2.5" fill="#6B3F1A" opacity="0.3"/>
  <circle cx="50" cy="60" r="3.5" fill="#6B3F1A" opacity="0.4"/>
  <circle cx="70" cy="68" r="2.5" fill="#6B3F1A" opacity="0.3"/>
  <circle cx="38" cy="72" r="3" fill="#6B3F1A" opacity="0.35"/>
  <!-- Chocolate chips -->
  <ellipse cx="42" cy="35" rx="7" ry="5.5" fill="#3D1F0A" transform="rotate(-15,42,35)"/>
  <ellipse cx="63" cy="34" rx="6" ry="4.5" fill="#3D1F0A" transform="rotate(10,63,34)"/>
  <ellipse cx="28" cy="60" rx="6.5" ry="5" fill="#3D1F0A" transform="rotate(-8,28,60)"/>
  <ellipse cx="55" cy="68" rx="7" ry="5" fill="#3D1F0A" transform="rotate(12,55,68)"/>
  <ellipse cx="72" cy="56" rx="5.5" ry="4" fill="#3D1F0A" transform="rotate(-5,72,56)"/>
  <!-- Chip highlights -->
  <ellipse cx="40" cy="33" rx="2.5" ry="1.5" fill="#6B3F1A" opacity="0.6" transform="rotate(-15,40,33)"/>
  <ellipse cx="61" cy="32" rx="2" ry="1.5" fill="#6B3F1A" opacity="0.6" transform="rotate(10,61,32)"/>
  <ellipse cx="26" cy="58" rx="2.5" ry="1.5" fill="#6B3F1A" opacity="0.6" transform="rotate(-8,26,58)"/>
  <ellipse cx="53" cy="66" rx="2.5" ry="1.5" fill="#6B3F1A" opacity="0.6" transform="rotate(12,53,66)"/>
  <!-- Surface sheen -->
  <ellipse cx="38" cy="28" rx="18" ry="10" fill="white" opacity="0.08" transform="rotate(-20,38,28)"/>
</svg>`;
}
