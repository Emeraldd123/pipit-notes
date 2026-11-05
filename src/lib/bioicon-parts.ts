// Named parts inside the key icons, as fractions [x, y] of the icon's own picture (0,0 = top-left, 1,1 = bottom-right),
// measured on a 10% grid. A diagram label can point at "mitochondrion.cristae" and the app finds that spot wherever
// the icon is drawn. Only parts that are clearly visible in the picture are listed.
export const BIOICON_PARTS: Record<string, Record<string, [number, number]>> = {
  "mitochondrion": { "outer membrane": [0.86, 0.12], "cristae": [0.42, 0.33], "matrix": [0.55, 0.55], "intermembrane space": [0.88, 0.45] },
  "nucleus": { "nuclear envelope": [0.5, 0.07], "nuclear pore": [0.75, 0.3], "nucleoplasm": [0.5, 0.75] },
  "epithelial cell": { "microvilli": [0.5, 0.07], "cell membrane": [0.02, 0.55], "cytoplasm": [0.5, 0.6] },
  "bacterium": { "cell wall": [0.2, 0.27], "cytoplasm": [0.32, 0.36], "flagellum": [0.85, 0.5] },
  "virus": { "capsid": [0.43, 0.13], "tail": [0.43, 0.36], "tail fibres": [0.2, 0.58] },
  "neuron": { "nucleus": [0.47, 0.47], "cell body": [0.58, 0.42], "dendrite": [0.15, 0.6] },
  "white blood cell": { "nucleus": [0.68, 0.45], "cytoplasm": [0.25, 0.62] },
  "egg cell": { "zona pellucida": [0.5, 0.03], "cell membrane": [0.19, 0.22], "cytoplasm": [0.4, 0.6], "spindle": [0.73, 0.5], "polar body": [0.94, 0.5] },
  "heart": { "aorta": [0.5, 0.07], "pulmonary artery": [0.63, 0.25], "superior vena cava": [0.17, 0.2], "right atrium": [0.2, 0.47], "right ventricle": [0.5, 0.65], "left ventricle": [0.85, 0.68] },
  "lung": { "upper lobe": [0.6, 0.12], "middle lobe": [0.7, 0.42], "lower lobe": [0.38, 0.72] },
  "kidney": { "capsule": [0.12, 0.35], "hilum": [0.62, 0.47], "ureter": [0.95, 0.8] },
  "brain": { "frontal lobe": [0.2, 0.35], "parietal lobe": [0.6, 0.18], "occipital lobe": [0.9, 0.45], "temporal lobe": [0.45, 0.72], "cerebellum": [0.82, 0.86] },
  "skin": { "epidermis": [0.5, 0.6], "dermis": [0.5, 0.8], "subcutaneous fat": [0.5, 0.95] },
  "eye": { "pupil": [0.56, 0.42], "iris": [0.47, 0.55], "sclera": [0.82, 0.6], "eyelashes": [0.35, 0.18] },
  "conical flask": { "neck": [0.5, 0.1], "solution": [0.5, 0.78] },
  "petri dish": { "agar": [0.5, 0.5], "rim": [0.5, 0.93] },
  "bunsen burner": { "barrel": [0.45, 0.22], "air hole": [0.48, 0.42], "gas inlet": [0.08, 0.61], "gas tap": [0.9, 0.63], "base": [0.5, 0.9] },
};
