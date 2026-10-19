"""Paper-sketch brand icon (lengoc.me family), embedded for packaging."""

FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs>
  <filter id="paper" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0"/>
    <feComposite operator="over" in2="SourceGraphic"/>
  </filter>
  <filter id="sketch" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="4" seed="7" result="w"/>
    <feDisplacementMap in="SourceGraphic" in2="w" scale="9"/>
  </filter>
  <clipPath id="round"><rect x="24" y="24" width="464" height="464" rx="110"/></clipPath>
</defs>
<rect x="24" y="24" width="464" height="464" rx="110" fill="#BEC9EE" filter="url(#paper)"/>
<g clip-path="url(#round)">
<g filter="url(#sketch)">

  <path d="M118 402 L400 402" stroke="#24357A" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M160 370 L160 288" stroke="#24357A" stroke-width="40" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M240 370 L240 218" stroke="#24357A" stroke-width="40" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M320 370 L320 146" stroke="#24357A" stroke-width="40" stroke-linecap="round" stroke-linejoin="round" fill="none"/>

</g>
</g>
<!-- signature: góc giấy gập — điểm nhận diện chung hệ lengoc.me -->
<g clip-path="url(#round)">
  <path d="M477.7 424.5 A110 110 0 0 1 424.5 477.7 Z" fill="#ffffff" opacity="0.9"/>
  <path d="M477.7 424.5 L424.5 477.7" stroke="#00000040" stroke-width="6" fill="none"/>
</g>

</svg>"""
