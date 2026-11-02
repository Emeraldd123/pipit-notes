// Sample student notes for tools/exam-eval.mjs: one unit each in five subjects, written the way a student
// takes notes. They teach principles but deliberately leave out the classic cases, experiments and
// applications a good examiner would bring in (inhibitors, real markets, real circuits, real studies…).
export const FIXTURES = [
  {
    id: "bio", title: "Bio — Cellular respiration", style: "AP Biology unit test",
    pages: [
      "Cellular respiration overview. C6H12O6 + 6 O2 -> 6 CO2 + 6 H2O + ATP. Stages: glycolysis (cytoplasm), pyruvate oxidation, Krebs / citric acid cycle (mitochondrial matrix), oxidative phosphorylation (inner mitochondrial membrane). Glycolysis: 1 glucose -> 2 pyruvate, net 2 ATP, 2 NADH. No O2 needed. Pyruvate oxidation: pyruvate -> acetyl CoA + CO2, makes NADH. Krebs per turn: 3 NADH, 1 FADH2, 1 ATP, 2 CO2. Two turns per glucose.",
      "Electron transport chain. NADH gives electrons to complex I, FADH2 to complex II. Electrons pass through complexes I -> III -> IV via ubiquinone and cytochrome c. O2 is the final electron acceptor, forms water at complex IV. As electrons move, complexes I, III and IV pump H+ from the matrix into the intermembrane space. This builds a proton gradient (proton-motive force). Chemiosmosis: H+ flows back through ATP synthase, which spins and makes ATP from ADP + Pi. About 2.5 ATP per NADH and 1.5 per FADH2 (FADH2 skips complex I so fewer H+ pumped). Total ~30-32 ATP per glucose.",
      "Fermentation. Without O2 the ETC stops, NADH can't be oxidised, NAD+ runs out, glycolysis would stop. Fermentation regenerates NAD+ so glycolysis continues (2 ATP only). Lactic acid fermentation (muscle): pyruvate -> lactate. Alcohol fermentation (yeast): pyruvate -> ethanol + CO2. Regulation: phosphofructokinase (PFK) is the key enzyme of glycolysis, inhibited by ATP and citrate, activated by AMP. Feedback inhibition keeps ATP production matched to demand.",
    ],
  },
  {
    id: "chem", title: "Chem — Chemical equilibrium", style: "university general chemistry midterm",
    pages: [
      "Dynamic equilibrium: forward rate = reverse rate, concentrations constant (not equal). Equilibrium constant K = [products]^coefficients / [reactants]^coefficients. Pure solids and liquids are left out. K >> 1 favours products, K << 1 favours reactants. Reaction quotient Q has the same form using current concentrations. Q < K: shifts right (forward). Q > K: shifts left. Q = K at equilibrium. K only changes with temperature.",
      "Le Chatelier's principle: a system at equilibrium that is disturbed shifts to partly counteract the change. Adding a reactant -> shifts right. Removing a product -> shifts right. Increasing pressure by decreasing volume -> shifts toward the side with fewer moles of gas. Adding an inert gas at constant volume -> no shift. Temperature: treat heat as a reactant (endothermic) or product (exothermic). Raising T for an exothermic reaction shifts left and K decreases. Catalysts speed up both directions equally: equilibrium is reached faster but its position and K do not change.",
      "ICE tables: Initial, Change, Equilibrium. Example: 1.00 M A in A <-> 2B, K = 4.0. Change -x for A, +2x for B. (2x)^2 / (1.00 - x) = 4.0 -> 4x^2 = 4.0 - 4.0x -> x^2 + x - 1 = 0 -> x = 0.618. [A] = 0.382 M, [B] = 1.24 M. Small-x approximation is OK when K is small and x < 5% of the initial concentration. Kp = Kc(RT)^(delta n gas).",
    ],
  },
  {
    id: "phys", title: "Physics — DC circuits", style: "AP Physics 2 exam",
    pages: [
      "Current I = charge per time, amps. Voltage V = energy per charge. Ohm's law V = IR. Power P = IV = I^2 R = V^2 / R. Resistance R = rho L / A: longer wire more resistance, thicker wire less. Resistivity rho depends on the material and rises with temperature for metals.",
      "Series: same current through each, voltages add, R_total = R1 + R2 + ... Parallel: same voltage across each branch, currents add, 1/R_total = 1/R1 + 1/R2 + ... Adding a branch in parallel lowers the total resistance and raises the total current from the source. Kirchhoff junction rule: current in = current out (charge conservation). Loop rule: sum of voltage changes around a loop = 0 (energy conservation).",
      "Real batteries have internal resistance r: terminal voltage V = emf - I r. Drawing more current lowers the terminal voltage. Maximum current when shorted: emf / r. Capacitors: Q = CV, energy = 1/2 C V^2. In a DC circuit a fully charged capacitor carries no current (acts like an open switch). RC time constant tau = RC: charges to 63% in one tau.",
    ],
  },
  {
    id: "econ", title: "Econ — Supply, demand and elasticity", style: "AP Microeconomics unit test",
    pages: [
      "Law of demand: price up, quantity demanded down (ceteris paribus). Demand shifters: income (normal vs inferior goods), prices of substitutes and complements, tastes, expectations, number of buyers. Law of supply: price up, quantity supplied up. Supply shifters: input costs, technology, number of sellers, expectations, taxes/subsidies. A change in price moves ALONG the curve; a change in a shifter SHIFTS the curve.",
      "Equilibrium where Qd = Qs. Shortage when price is below equilibrium (Qd > Qs), surplus when above. Demand increase -> P and Q both rise. Supply increase -> P falls, Q rises. Both shift: one of P or Q is indeterminate. Consumer surplus = area under demand above price; producer surplus = area above supply below price. Deadweight loss = total surplus lost compared to equilibrium.",
      "Price elasticity of demand = %change Qd / %change P (absolute value). Elastic > 1, inelastic < 1, unit = 1. More elastic with many substitutes, luxuries, big share of budget, long time horizon. Total revenue test: if demand is inelastic, raising price raises total revenue; if elastic, raising price lowers it. Tax incidence: the side that is LESS elastic pays more of a tax. Price ceilings (max price) bind below equilibrium; price floors (min price) bind above.",
    ],
  },
  {
    id: "stats", title: "Stats — Hypothesis testing", style: "introductory statistics midterm",
    pages: [
      "Hypothesis test steps: state H0 (no effect / no difference) and Ha. Choose significance level alpha (often 0.05). Check conditions: random sample, independence (10% rule), normality (n >= 30 or approximately normal population, or np >= 10 and n(1-p) >= 10 for proportions). Compute test statistic z or t = (statistic - null value) / standard error. P-value = probability of a result at least as extreme as observed IF H0 is true.",
      "Decision: if p-value < alpha, reject H0 (statistically significant evidence for Ha). Otherwise fail to reject H0 (never 'accept'). Type I error: reject a true H0, probability = alpha. Type II error: fail to reject a false H0, probability beta. Power = 1 - beta = probability of correctly rejecting a false H0. Power increases with larger n, larger alpha, larger true effect, smaller variability.",
      "Statistical significance is not practical significance: with a huge n even a tiny effect can give a small p-value. Confidence interval: estimate +/- critical value x SE. A 95% CI that does not contain the null value matches rejecting H0 at alpha = 0.05 (two-sided). Observational studies show association, not causation; confounding variables can create associations. Only randomised experiments support cause and effect. Multiple tests at alpha 0.05 raise the chance of at least one false positive.",
    ],
  },
];
