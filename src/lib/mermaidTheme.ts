// Mermaid themes from design/DESIGN_SPEC.md §10. themeVariables need real hex values, so they
// live here next to the CSS tokens rather than being read from CSS.

const font = "'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, sans-serif";

const lightCss = `
  .cluster-label, .cluster-label span { font-family: 'JetBrains Mono', monospace; font-size: 11px;
    letter-spacing: .05em; text-transform: uppercase; fill: #4D5966; color: #4D5966; }
  .edgeLabel, .edgeLabel p { font-size: 13px; color: #4D5966; background: #FFFFFF; }
  .node rect, .node polygon, .node circle { rx: 10px; ry: 10px; stroke-width: 1px; }
  .cluster rect { stroke-dasharray: 4 3; rx: 12px; ry: 12px; }
  .flowchart-link { stroke-width: 1.5px; }
`;

export const mermaidLight = {
  theme: 'base' as const,
  fontFamily: font,
  flowchart: { curve: 'linear' as const, htmlLabels: true, padding: 12, nodeSpacing: 48, rankSpacing: 56 },
  sequence: { mirrorActors: false, actorMargin: 48 },
  themeVariables: {
    darkMode: false,
    fontFamily: font,
    fontSize: '15px',
    background: '#FFFFFF',
    primaryColor: '#FFFFFF',
    primaryBorderColor: '#B3BECA',
    primaryTextColor: '#121820',
    secondaryColor: '#E7ECFD',
    secondaryBorderColor: '#BAC6F6',
    secondaryTextColor: '#121820',
    tertiaryColor: '#F9FAFC',
    tertiaryBorderColor: '#C3CCD6',
    tertiaryTextColor: '#4D5966',
    mainBkg: '#FFFFFF',
    nodeBorder: '#B3BECA',
    nodeTextColor: '#121820',
    lineColor: '#4D5966',
    textColor: '#121820',
    titleColor: '#121820',
    clusterBkg: '#F9FAFC',
    clusterBorder: '#C3CCD6',
    edgeLabelBackground: '#FFFFFF',
    noteBkgColor: '#FCF2DF',
    noteBorderColor: '#E9CB8F',
    noteTextColor: '#121820',
    actorBkg: '#FFFFFF',
    actorBorder: '#B3BECA',
    actorTextColor: '#121820',
    actorLineColor: '#7D8996',
    signalColor: '#4D5966',
    signalTextColor: '#121820',
    labelBoxBkgColor: '#EDF1F5',
    labelBoxBorderColor: '#B3BECA',
    labelTextColor: '#121820',
    loopTextColor: '#4D5966',
    activationBkgColor: '#E7ECFD',
    activationBorderColor: '#2F4FD8',
    sequenceNumberColor: '#FFFFFF',
    errorBkgColor: '#FCEBE9',
    errorTextColor: '#9C271E',
  },
  themeCSS: lightCss,
};

export const mermaidDark = {
  ...mermaidLight,
  themeVariables: {
    ...mermaidLight.themeVariables,
    darkMode: true,
    background: '#151A21',
    primaryColor: '#1C232C',
    primaryBorderColor: '#3B4652',
    primaryTextColor: '#E4E9EE',
    secondaryColor: '#1E2547',
    secondaryBorderColor: '#3A4790',
    secondaryTextColor: '#E4E9EE',
    tertiaryColor: '#171D25',
    tertiaryBorderColor: '#36414D',
    tertiaryTextColor: '#A5B0BC',
    mainBkg: '#1C232C',
    nodeBorder: '#3B4652',
    nodeTextColor: '#E4E9EE',
    lineColor: '#A5B0BC',
    textColor: '#E4E9EE',
    titleColor: '#E4E9EE',
    clusterBkg: '#171D25',
    clusterBorder: '#36414D',
    edgeLabelBackground: '#151A21',
    noteBkgColor: '#2A2110',
    noteBorderColor: '#6E5322',
    noteTextColor: '#E4E9EE',
    actorBkg: '#1C232C',
    actorBorder: '#3B4652',
    actorTextColor: '#E4E9EE',
    actorLineColor: '#6B7785',
    signalColor: '#A5B0BC',
    signalTextColor: '#E4E9EE',
    labelBoxBkgColor: '#1C232C',
    labelBoxBorderColor: '#3B4652',
    labelTextColor: '#E4E9EE',
    loopTextColor: '#A5B0BC',
    activationBkgColor: '#1E2547',
    activationBorderColor: '#8B9EFF',
    sequenceNumberColor: '#0B1020',
    errorBkgColor: '#2D1614',
    errorTextColor: '#FFB3A9',
  },
  themeCSS: lightCss.replaceAll('#4D5966', '#A5B0BC').replace('background: #FFFFFF', 'background: #151A21'),
};
