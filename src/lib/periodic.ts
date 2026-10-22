// Periodic table data + layout (pure; used by the "Periodic table" page template).
export const SYMBOLS = (
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
  "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu " +
  "Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr " +
  "Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og"
).split(" ");

export type Category = "alkali" | "alkaline" | "transition" | "post" | "metalloid" | "nonmetal" | "halogen" | "noble" | "lanthanide" | "actinide" | "unknown";

export function categoryOf(z: number): Category {
  if ([3, 11, 19, 37, 55, 87].includes(z)) return "alkali";
  if ([4, 12, 20, 38, 56, 88].includes(z)) return "alkaline";
  if ((z >= 57 && z <= 71)) return "lanthanide";
  if ((z >= 89 && z <= 103)) return "actinide";
  if ([5, 14, 32, 33, 51, 52].includes(z)) return "metalloid";
  if ([9, 17, 35, 53, 85, 117].includes(z)) return "halogen";
  if ([2, 10, 18, 36, 54, 86, 118].includes(z)) return "noble";
  if ([1, 6, 7, 8, 15, 16, 34].includes(z)) return "nonmetal";
  if ([13, 31, 49, 50, 81, 82, 83, 84, 113, 114, 115, 116].includes(z)) return "post";
  if ((z >= 21 && z <= 30) || (z >= 39 && z <= 48) || (z >= 72 && z <= 80) || (z >= 104 && z <= 112)) return "transition";
  return "unknown";
}

export const CATEGORY_COLORS: Record<Category, string> = {
  alkali: "#fecaca", alkaline: "#fed7aa", transition: "#fef08a", post: "#bbf7d0", metalloid: "#a7f3d0",
  nonmetal: "#bfdbfe", halogen: "#c7d2fe", noble: "#e9d5ff", lanthanide: "#fbcfe8", actinide: "#f5d0fe", unknown: "#e5e7eb",
};

/** Grid position (1-based column, 1-based row; rows 9-10 are the detached f-block) for atomic number z. */
export function cellOf(z: number): { col: number; row: number } {
  if (z === 1) return { col: 1, row: 1 };
  if (z === 2) return { col: 18, row: 1 };
  if (z <= 4) return { col: z - 2, row: 2 };
  if (z <= 10) return { col: z + 8, row: 2 };
  if (z <= 12) return { col: z - 10, row: 3 };
  if (z <= 18) return { col: z, row: 3 };
  if (z <= 36) return { col: z - 18, row: 4 };
  if (z <= 54) return { col: z - 36, row: 5 };
  if (z <= 56) return { col: z - 54, row: 6 };
  if (z <= 70) return { col: z - 54, row: 9 };          // La–Yb in the f-block row
  if (z === 71) return { col: 3, row: 6 };               // Lu sits under Y
  if (z <= 86) return { col: z - 68, row: 6 };
  if (z <= 88) return { col: z - 86, row: 7 };
  if (z <= 102) return { col: z - 86, row: 10 };        // Ac–No
  if (z === 103) return { col: 3, row: 7 };              // Lr
  return { col: z - 100, row: 7 };
}
